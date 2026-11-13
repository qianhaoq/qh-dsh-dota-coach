package main

import (
	"bytes"
	"compress/bzip2"
	"github.com/klauspost/compress/zstd"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestIdentityClassification(t *testing.T) {
	cases := []struct {
		selected, available bool
		clone               interface{}
		want                string
	}{{true, true, false, "real_hero"}, {false, true, false, "illusion_or_replica"}, {true, true, true, "clone"}, {false, false, nil, "unknown"}}
	for _, c := range cases {
		if got := classify(c.selected, c.available, c.clone); got != c.want {
			t.Fatalf("%s != %s", got, c.want)
		}
	}
}
func TestDecodeAtomicLimitAndFormats(t *testing.T) {
	dir := t.TempDir()
	raw := append([]byte("PBDEMS2\x00"), bytes.Repeat([]byte{1}, 100)...)
	enc, _ := zstd.NewWriter(nil)
	compressed := enc.EncodeAll(raw, nil)
	enc.Close()
	for name, data := range map[string][]byte{"dem": raw, "zstd": compressed, "misnamed.dem.bz2": compressed, "download": compressed} {
		t.Run(name, func(t *testing.T) {
			out := filepath.Join(dir, name+"-out")
			os.MkdirAll(out, 0700)
			src := filepath.Join(dir, name)
			os.WriteFile(src, data, 0600)
			path, meta, err := decode(src, out, 1000)
			if err != nil {
				t.Fatal(err)
			}
			if name == "dem" && meta["format"] != "raw" {
				t.Fatalf("raw demo format = %v", meta["format"])
			}
			if name != "dem" && meta["format"] != "zstd" {
				t.Fatal(meta)
			}
			if meta["bytes"] != int64(len(raw)) {
				t.Fatal(meta)
			}
			b, _ := os.ReadFile(path)
			if !bytes.Equal(b, raw) {
				t.Fatal("changed decoded bytes")
			}
		})
	}
	out := filepath.Join(dir, "limited")
	os.MkdirAll(out, 0700)
	src := filepath.Join(dir, "zstd")
	_, _, err := decode(src, out, 20)
	if err == nil {
		t.Fatal("size limit accepted")
	}
	if _, err = os.Stat(filepath.Join(out, "replay.dem")); !os.IsNotExist(err) {
		t.Fatal("committed partial replay")
	}
}
func TestBz2FixtureAndCorruption(t *testing.T) {
	src := filepath.Join("..", "fixtures", "tiny.dem.bz2")
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join("..", "fixtures", "tiny.dem"))
	if err != nil {
		t.Fatal(err)
	}
	buf := new(bytes.Buffer)
	if _, err = buf.ReadFrom(bzip2.NewReader(bytes.NewReader(data))); err != nil || !bytes.Equal(raw, buf.Bytes()) {
		t.Fatal("fixture invalid")
	}
	if _, _, err = decode(src, t.TempDir(), 1000); err != nil {
		t.Fatal(err)
	}
	bad := filepath.Join(t.TempDir(), "bad")
	os.WriteFile(bad, []byte("not a replay"), 0600)
	if _, _, err = decode(bad, t.TempDir(), 1000); err == nil {
		t.Fatal("unrecognized header accepted")
	}
}

func TestNativeClockUsesServerTickAndFreezesDuringPause(t *testing.T) {
	clock, ok := clockFromTicks(10536, 1.0/30, 242.30002, 0, false, 0)
	if !ok || math.Abs(clock-108.89998) > 0.001 {
		t.Fatal(clock, ok)
	}
	a, ok := clockFromTicks(11000, 1.0/30, 200, 60, true, 10900)
	b, _ := clockFromTicks(11100, 1.0/30, 200, 60, true, 10900)
	c, _ := clockFromTicks(11200, 1.0/30, 200, 360, false, 0)
	if !ok || a != b || math.Abs(a-c) > 0.0001 {
		t.Fatal(a, b, c)
	}
	if _, ok := clockFromTicks(0, 1.0/30, 0, 0, false, 0); ok {
		t.Fatal("unknown clock became time zero")
	}
}
func TestControlBitsAndUnknownFieldsStayDistinct(t *testing.T) {
	if controlStates(nil) != nil || numeric(nil) != nil {
		t.Fatal("missing state became zero")
	}
	states := controlStates(uint64((1 << 3) | (1 << 5))).(Row)
	if states["silenced"] != true || states["stunned"] != true || states["muted"] != false {
		t.Fatal(states)
	}
	if numeric(float64(math.Inf(1))) != nil {
		t.Fatal("infinite number accepted")
	}
}

func TestObjectiveClockUsesPausedMatchTime(t *testing.T) {
	// Demo tick deliberately differs from server tick; completed and active
	// pauses must both be excluded, and horn time must be subtracted.
	const demoTick = 15000
	for _, serverTick := range []uint32{11000, 11100} {
		row := objectiveRow(func() (float64, bool) {
			return clockFromTicks(serverTick, 1.0/30, 200, 60, true, 10900)
		}, "tower", "npc_dota_badguys_tower4", "1:1")
		want := float64(10900-60)/30 - 200
		if math.Abs(row["t"].(float64)-want) > 0.00001 || row["t"] == float64(demoTick)/30 {
			t.Fatal(row)
		}
	}
	row := objectiveRow(func() (float64, bool) { return 0, false }, "tower", "building", "1:1")
	if row["t"] != nil {
		t.Fatal("unknown clock invented citation time", row)
	}
}

func TestClockEndRequiresFortBuildingKill(t *testing.T) {
	c := &matchClock{basis: newClockBasis()}
	for _, row := range []Row{
		{"type": "DOTA_COMBATLOG_TEAM_BUILDING_KILL", "target": "npc_dota_badguys_tower4", "t": 1900.0},
		{"type": "DOTA_COMBATLOG_DEATH", "target": "npc_dota_badguys_fort", "t": 1901.0},
	} {
		c.observeEnd(row)
	}
	if c.basis["game_end"] != nil {
		t.Fatal(c.basis)
	}
	c.observeEnd(Row{"type": "DOTA_COMBATLOG_TEAM_BUILDING_KILL", "target": "npc_dota_badguys_fort", "t": 1906.767})
	if c.basis["game_end"].(Row)["t"] != 1906.767 {
		t.Fatal(c.basis)
	}
}
