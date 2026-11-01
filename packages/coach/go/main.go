// dota-extract decodes replay containers and samples identified entities at packet boundaries.
package main

import (
	"bufio"
	"compress/bzip2"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"github.com/klauspost/compress/zstd"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Row map[string]interface{}

func main() {
	if err := run(os.Args[1:]); err != nil {
		b, _ := json.Marshal(Row{"ok": false, "error": err.Error()})
		fmt.Println(string(b))
		os.Exit(1)
	}
}
func run(args []string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("parser panic: %v", r)
		}
	}()
	started := time.Now()
	var in, out string
	every := uint32(15)
	max := int64(4_000_000_000)
	maxOutput := int64(4_000_000_000)
	only := false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--quiet":
		case "--decompress-only":
			only = true
		case "--sample-every", "--max-bytes", "--max-output-bytes":
			flag := args[i]
			i++
			if i >= len(args) {
				return errors.New("missing flag value")
			}
			n, e := strconv.ParseInt(args[i], 10, 64)
			if e != nil || n <= 0 {
				return errors.New("limits must be positive")
			}
			if flag == "--sample-every" {
				if n > 300 {
					return errors.New("sample interval exceeds 300 ticks")
				}
				every = uint32(n)
			} else if flag == "--max-output-bytes" {
				maxOutput = n
			} else {
				max = n
			}
		default:
			if strings.HasPrefix(args[i], "--") {
				return errors.New("unknown flag " + args[i])
			}
			if in == "" {
				in = args[i]
			} else if out == "" {
				out = args[i]
			} else {
				return errors.New("too many arguments")
			}
		}
	}
	if in == "" || out == "" {
		return errors.New("usage: dota-extract <input> <outdir> [--decompress-only] [--max-bytes N] [--sample-every N]")
	}
	if err = os.MkdirAll(out, 0700); err != nil {
		return err
	}
	demo := in
	var cleanup func()
	meta := Row{}
	if only || !isDemo(in) {
		demo, meta, err = decode(in, out, max)
		if err != nil {
			return err
		}
		cleanup = func() { os.Remove(demo) }
		if only {
			meta["ok"] = true
			return emit(meta)
		}
		defer cleanup()
	}
	st, err := os.Stat(demo)
	if err != nil {
		return err
	}
	if st.Size() > max {
		return errors.New("input size limit exceeded")
	}
	trace := filepath.Join(out, "trace")
	if err = os.MkdirAll(trace, 0700); err != nil {
		return err
	}
	hs, err := os.Create(filepath.Join(trace, "heroes.jsonl"))
	if err != nil {
		return err
	}
	defer hs.Close()
	ws, err := os.Create(filepath.Join(trace, "wards.jsonl"))
	if err != nil {
		return err
	}
	defer ws.Close()
	osf, err := os.Create(filepath.Join(trace, "objectives.jsonl"))
	if err != nil {
		return err
	}
	defer osf.Close()
	total := int64(0)
	encode := func(w io.Writer, r Row) error {
		b, e := json.Marshal(r)
		if e != nil {
			return e
		}
		total += int64(len(b) + 1)
		if total > maxOutput {
			return errors.New("trace size limit exceeded")
		}
		_, e = w.Write(append(b, '\n'))
		return e
	}
	f, err := os.Open(demo)
	if err != nil {
		return err
	}
	defer f.Close()
	p, err := manta.NewStreamParser(f)
	if err != nil {
		return err
	}
	states, err := os.Create(filepath.Join(trace, "states.jsonl"))
	if err != nil {
		return err
	}
	defer states.Close()
	events, err := os.Create(filepath.Join(trace, "events.jsonl"))
	if err != nil {
		return err
	}
	defer events.Close()
	wardOutput, err := os.Create(filepath.Join(trace, "wards-native.jsonl"))
	if err != nil {
		return err
	}
	defer wardOutput.Close()
	tactical := registerTactical(p, states, events, wardOutput, encode)
	entities := map[string]*manta.Entity{}
	wards := map[string]Row{}
	objectives := map[string]bool{}
	var resource *manta.Entity
	samples, nwards, nobj := 0, 0, 0
	nextTick := uint32(0)
	t := func() float64 { return float64(p.Tick) / 30 }
	identity := func(e *manta.Entity) string { return fmt.Sprintf("%d:%d", e.GetIndex(), e.GetSerial()) }
	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		name, id := e.GetClassName(), identity(e)
		if strings.Contains(name, "PlayerResource") {
			resource = e
		}
		if strings.HasPrefix(name, "CDOTA_Unit_Hero_") {
			if op.Flag(manta.EntityOpDeleted) || op.Flag(manta.EntityOpLeft) {
				delete(entities, id)
			} else {
				entities[id] = e
			}
			return nil
		}
		if name == "CDOTA_NPC_Observer_Ward" || name == "CDOTA_NPC_Observer_Ward_TrueSight" {
			if op.Flag(manta.EntityOpDeleted) {
				if old, ok := wards[id]; ok {
					r := clone(old)
					r["t"] = t()
					r["event"] = "deleted"
					r["lifecycle"] = "known"
					if err := encode(ws, r); err != nil {
						return err
					}
					delete(wards, id)
				}
				return nil
			}
			if _, ok := wards[id]; !ok {
				x, y, ok := pos(e)
				if !ok {
					return nil
				}
				team, _ := asInt(e.Get("m_iTeamNum"))
				kind := "observer"
				if strings.HasSuffix(name, "TrueSight") {
					kind = "sentry"
				}
				r := Row{"t": t(), "entity_id": id, "kind": kind, "team": team, "x": x, "y": y, "event": "created", "lifecycle": "unknown_until_deleted"}
				wards[id] = r
				nwards++
				return encode(ws, r)
			}
			return nil
		}
		if name == "CDOTA_BaseNPC_Tower" || name == "CDOTA_BaseNPC_Barracks" {
			hp, ok := asInt(e.Get("m_iHealth"))
			if !ok || hp > 0 || objectives[id] {
				return nil
			}
			idx, ok := e.GetInt32("m_iUnitNameStringTableIndex")
			if !ok {
				return nil
			}
			building, ok := p.LookupStringByIndex("UnitNames", idx)
			if !ok || !strings.HasPrefix(building, "npc_dota_") {
				return nil
			}

			objectives[id] = true
			nobj++
			return encode(osf, Row{"t": t(), "what": name, "building_id": building, "entity_id": id})
		}
		return nil
	})
	p.Callbacks.OnCDemoPacket(func(_ *dota.CDemoPacket) error {
		if p.Tick < nextTick {
			return nil
		}
		nextTick = (p.Tick/every + 1) * every
		selected := map[string]bool{}
		if resource != nil {
			for i := 0; i < 24; i++ {
				handle, ok := resource.GetUint32(fmt.Sprintf("m_vecPlayerTeamData.%04d.m_hSelectedHero", i))
				if ok && handle != 16777215 {
					if hero := p.FindEntityByHandle(uint64(handle)); hero != nil {
						selected[identity(hero)] = true
					}
				}
			}
		}
		ids := make([]string, 0, len(entities))
		for id := range entities {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			e := entities[id]
			x, y, ok := pos(e)
			if !ok {
				continue
			}
			kind := classify(selected[id], len(selected) > 0, e.Get("m_bIsClone"))
			hp, _ := asInt(e.Get("m_iHealth"))
			team, _ := asInt(e.Get("m_iTeamNum"))
			lvl, _ := asInt(e.Get("m_iLevel"))
			life, known := asInt(e.Get("m_lifeState"))
			var alive interface{} = nil
			if known {
				alive = life
			}
			if err := encode(hs, Row{"t": t(), "hero": strings.TrimPrefix(e.GetClassName(), "CDOTA_Unit_Hero_"), "entity_id": id, "entity_kind": kind, "identity_method": "player_resource_selected_handle", "team": team, "x": x, "y": y, "hp": hp, "lvl": lvl, "alive": alive}); err != nil {
				return err
			}
			samples++
		}
		return nil
	})
	if err = p.Start(); err != nil {
		return err
	}
	return emit(Row{"ok": true, "trace_version": tacticalVersion, "tactical": *tactical, "samples": samples, "wards": nwards, "objectives": nobj, "ticks": p.Tick, "sample_every_ticks": every, "clock": "demo_tick_30hz_requires_calibration", "bytes": st.Size(), "output_bytes": total, "ms": time.Since(started).Milliseconds()})
}
func classify(selected, hasSelection bool, cloneValue interface{}) string {
	if clone, ok := cloneValue.(bool); ok && clone {
		return "clone"
	}
	if selected {
		return "real_hero"
	}
	if hasSelection {
		return "illusion_or_replica"
	}
	return "unknown"
}
func clone(r Row) Row {
	out := Row{}
	for k, v := range r {
		out[k] = v
	}
	return out
}
func emit(r Row) error {
	b, e := json.Marshal(r)
	if e == nil {
		fmt.Println(string(b))
	}
	return e
}
func asInt(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case int32:
		return int64(n), true
	case uint32:
		return int64(n), true
	case uint64:
		return int64(n), true
	case int64:
		return n, true
	case int:
		return int64(n), true
	case uint8:
		return int64(n), true
	}
	return 0, false
}
func number(v interface{}) float64 {
	switch n := v.(type) {
	case float32:
		return float64(n)
	case float64:
		return n
	}
	return 0
}
func pos(e *manta.Entity) (float64, float64, bool) {
	x, a := asInt(e.Get("CBodyComponent.m_cellX"))
	y, b := asInt(e.Get("CBodyComponent.m_cellY"))
	return float64(x)*128 + number(e.Get("CBodyComponent.m_vecX")) - 16384, float64(y)*128 + number(e.Get("CBodyComponent.m_vecY")) - 16384, a && b
}
func isDemo(path string) bool {
	f, e := os.Open(path)
	if e != nil {
		return false
	}
	defer f.Close()
	b := make([]byte, 8)
	io.ReadFull(f, b)
	return strings.HasPrefix(string(b), "PBDEMS2")
}
func decode(src, out string, max int64) (string, Row, error) {
	f, e := os.Open(src)
	if e != nil {
		return "", nil, e
	}
	defer f.Close()
	r := bufio.NewReader(f)
	magic, e := r.Peek(8)
	if e != nil {
		return "", nil, e
	}
	var input io.Reader = r
	format := "dem"
	switch {
	case string(magic[:3]) == "BZh":
		input = bzip2.NewReader(r)
		format = "bz2"
	case string(magic[:4]) == "\x28\xb5\x2f\xfd":
		z, err := zstd.NewReader(r, zstd.WithDecoderMaxMemory(uint64(min(int64(512<<20), maxInt64(max, 1<<20)))), zstd.WithDecoderConcurrency(1))
		if err != nil {
			return "", nil, err
		}
		defer z.Close()
		input = z
		format = "zstd"
	case string(magic[:7]) == "PBDEMS2":
	default:
		return "", nil, errors.New("unrecognized replay format")
	}
	path := filepath.Join(out, "replay.dem")
	tmp := path + ".part"
	dest, e := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return "", nil, e
	}
	success := false
	defer func() {
		dest.Close()
		if !success {
			os.Remove(tmp)
		}
	}()
	hash := sha256.New()
	n, e := io.Copy(io.MultiWriter(dest, hash), io.LimitReader(input, max+1))
	if e != nil {
		return "", nil, e
	}
	if n > max {
		return "", nil, errors.New("decompressed size limit exceeded")
	}
	if e = dest.Close(); e != nil {
		return "", nil, e
	}
	if !isDemo(tmp) {
		return "", nil, errors.New("decoded data is not a Source 2 replay")
	}
	if e = os.Rename(tmp, path); e != nil {
		return "", nil, e
	}
	success = true
	return path, Row{"format": format, "bytes": n, "sha256": hex.EncodeToString(hash.Sum(nil))}, nil
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
