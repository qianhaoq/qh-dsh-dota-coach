package main

import (
	"fmt"
	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"io"
	"math"
	"regexp"
	"strings"
)

const tacticalVersion = 3

var camelBoundary = regexp.MustCompile(`([a-z0-9])([A-Z])`)

func snake(s string) string { return strings.ToLower(camelBoundary.ReplaceAllString(s, `${1}_${2}`)) }
func numeric(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	switch n := v.(type) {
	case float32:
		if !math.IsNaN(float64(n)) && !math.IsInf(float64(n), 0) {
			return float64(n)
		}
	case float64:
		if !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n
		}
	default:
		if n, ok := asInt(v); ok {
			return n
		}
	}
	return nil
}
func gameClock(serverTick uint32, interval float64, rules *manta.Entity) (float64, bool) {
	if rules == nil || serverTick == 0 {
		return 0, false
	}
	start, ok := numeric(rules.Get("m_pGameRules.m_flGameStartTime")).(float64)
	if !ok || start <= 0 {
		return 0, false
	}
	paused, ok := asInt(rules.Get("m_pGameRules.m_nTotalPausedTicks"))
	if !ok {
		return 0, false
	}
	isPaused, _ := rules.Get("m_pGameRules.m_bGamePaused").(bool)
	pauseStart, _ := asInt(rules.Get("m_pGameRules.m_nPauseStartTick"))
	return clockFromTicks(serverTick, interval, start, paused, isPaused, pauseStart)
}
func clockFromTicks(serverTick uint32, interval, start float64, paused int64, isPaused bool, pauseStart int64) (float64, bool) {
	if serverTick == 0 || interval <= 0 || start <= 0 || paused < 0 {
		return 0, false
	}
	ticks := int64(serverTick) - paused
	if isPaused {
		if pauseStart <= 0 || pauseStart > int64(serverTick) {
			return 0, false
		}
		ticks -= int64(serverTick) - pauseStart
	}
	return float64(ticks)*interval - start, true

}

// Source: SteamTracking/GameTracking-Dota2 DumpSource2/schemas/client/modifierstate.h.
// These are state observations, not a complete permission-to-cast model.
func controlStates(value interface{}) interface{} {
	if value == nil {
		return nil
	}
	var bits uint64
	switch v := value.(type) {
	case uint64:
		bits = v
	case uint32:
		bits = uint64(v)
	case int64:
		bits = uint64(v)
	case int32:
		bits = uint64(v)
	default:
		return nil
	}
	fields := map[string]uint{"rooted": 0, "silenced": 3, "muted": 4, "stunned": 5, "hexed": 6, "nightmared": 11, "command_restricted": 20, "out_of_game": 33, "feared": 47, "taunted": 48, "debuff_immune": 56}
	out := Row{}
	for name, bit := range fields {
		out[name] = bits&(uint64(1)<<bit) != 0
	}
	return out
}
func entityName(p *manta.Parser, e *manta.Entity) string {
	if i, ok := e.GetInt32("m_pEntity.m_nameStringTableIndex"); ok {
		if n, ok := p.LookupStringByIndex("EntityNames", i); ok && n != "" {
			return n
		}
	}
	return snake(strings.TrimPrefix(strings.TrimPrefix(e.GetClassName(), "CDOTA_Ability_"), "CDOTA_Item_"))
}
func handles(p *manta.Parser, e *manta.Entity, prefix string, count int) []Row {
	out := []Row{}
	for i := 0; i < count; i++ {
		h, ok := e.GetUint32(fmt.Sprintf("%s.%04d", prefix, i))
		if !ok || h == 16777215 {
			continue
		}
		a := p.FindEntityByHandle(uint64(h))
		if a == nil {
			continue
		}
		name := entityName(p, a)
		if strings.Contains(name, "generic_hidden") || strings.Contains(name, "special_bonus") {
			continue
		}
		out = append(out, Row{"slot": i, "name": name, "level": numeric(a.Get("m_iLevel")), "cooldown": numeric(a.Get("m_fCooldown")), "mana_cost": numeric(a.Get("m_iManaCost")), "charges": numeric(a.Get("m_iCurrentCharges")), "ability_charges": numeric(a.Get("m_nAbilityCurrentCharges")), "in_phase": a.Get("m_bInAbilityPhase"), "channel_start": numeric(a.Get("m_flChannelStartTime")), "cooldown_frozen": a.Get("m_bFrozenCooldown"), "castability": "not_inferred"})
	}
	return out
}

// Visibility observations are valid at the event instant, never continuous vision.
func registerTactical(p *manta.Parser, states, events, wardOutput io.Writer, encode func(io.Writer, Row) error) *Row {
	summary := Row{"version": tacticalVersion, "clock": "server_tick_pause_adjusted", "sample_seconds": 0.25, "visibility": "event_observations_or_entity_mask; unknown_between_observations", "cooldown_semantics": "remaining_seconds", "states": 0, "events": 0}
	var rules, resource *manta.Entity
	heroes := map[string]*manta.Entity{}
	var tick uint32
	interval := 1.0 / 30.0
	next := uint32(0)
	samples, nevents := 0, 0
	wards := map[string]Row{}
	p.Callbacks.OnCSVCMsg_ServerInfo(func(m *dota.CSVCMsg_ServerInfo) error {
		if m.GetTickInterval() > 0 {
			interval = float64(m.GetTickInterval())
		}
		return nil
	})
	p.Callbacks.OnCNETMsg_Tick(func(m *dota.CNETMsg_Tick) error { tick = m.GetTick(); return nil })
	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		name := e.GetClassName()
		if strings.Contains(strings.ToLower(name), "gamerules") {
			rules = e
		}
		if strings.Contains(name, "PlayerResource") {
			resource = e
		}
		if name == "CDOTA_NPC_Observer_Ward" || name == "CDOTA_NPC_Observer_Ward_TrueSight" {
			id := fmt.Sprintf("%d:%d", e.GetIndex(), e.GetSerial())
			gt, clockKnown := gameClock(tick, interval, rules)
			if op.Flag(manta.EntityOpDeleted) {
				if row, ok := wards[id]; ok {
					if clockKnown {
						gone := clone(row)
						gone["t"] = gt
						gone["event"] = "deleted"
						if err := encode(wardOutput, gone); err != nil {
							return err
						}
					}
					delete(wards, id)
				}
				return nil
			}
			if _, known := wards[id]; !known {
				x, y, ok := pos(e)
				if ok {
					kind := "observer"
					if strings.HasSuffix(name, "TrueSight") {
						kind = "sentry"
					}
					row := Row{"entity_id": id, "team": numeric(e.Get("m_iTeamNum")), "x": x, "y": y, "kind": kind, "event": "present", "t": nil}
					if clockKnown {
						row["t"] = gt
						row["event"] = "created"
						if err := encode(wardOutput, row); err != nil {
							return err
						}
					}
					wards[id] = row
				}
			}
			return nil
		}
		if strings.HasPrefix(name, "CDOTA_Unit_Hero_") {
			id := fmt.Sprintf("%d:%d", e.GetIndex(), e.GetSerial())
			if op.Flag(manta.EntityOpDeleted) || op.Flag(manta.EntityOpLeft) {
				delete(heroes, id)
			} else {
				heroes[id] = e
			}
		}
		return nil
	})
	p.Callbacks.OnCDemoPacket(func(_ *dota.CDemoPacket) error {
		if p.Tick < next {
			return nil
		}
		next = p.Tick + uint32(math.Max(1, math.Floor(0.25/interval)))
		gt, ok := gameClock(tick, interval, rules)
		if !ok {
			return nil
		}
		for _, ward := range wards {
			if ward["t"] == nil {
				ward["t"] = gt
				if err := encode(wardOutput, ward); err != nil {
					return err
				}
			}
		}
		selected := map[string]int{}
		if resource != nil {
			for i := 0; i < 24; i++ {
				h, ok := resource.GetUint32(fmt.Sprintf("m_vecPlayerTeamData.%04d.m_hSelectedHero", i))
				if ok && h != 16777215 {
					if e := p.FindEntityByHandle(uint64(h)); e != nil {
						selected[fmt.Sprintf("%d:%d", e.GetIndex(), e.GetSerial())] = i
					}
				}
			}
		}
		for id, e := range heroes {
			player, selectedHero := selected[id]
			kind := classify(selectedHero, len(selected) > 0, e.Get("m_bIsClone"))
			if kind != "real_hero" {
				continue
			}
			x, y, ok := pos(e)
			if !ok {
				continue
			}
			var vr, vd interface{}
			if mask, ok := asInt(e.Get("m_iTaggedAsVisibleByTeam")); ok {
				vr = mask&(1<<2) != 0
				vd = mask&(1<<3) != 0
			}
			state := Row{"t": gt, "tick": p.Tick, "server_tick": tick, "entity_id": id, "hero": snake(strings.TrimPrefix(e.GetClassName(), "CDOTA_Unit_Hero_")), "player_index": player, "entity_kind": kind, "team": numeric(e.Get("m_iTeamNum")), "x": x, "y": y, "hp": numeric(e.Get("m_iHealth")), "max_hp": numeric(e.Get("m_iMaxHealth")), "mana": numeric(e.Get("m_flMana")), "max_mana": numeric(e.Get("m_flMaxMana")), "level": numeric(e.Get("m_iCurrentLevel")), "life_state": numeric(e.Get("m_lifeState")), "unit_state": fmt.Sprint(e.Get("m_nUnitState64")), "controls": controlStates(e.Get("m_nUnitState64")), "visible_radiant": vr, "visible_dire": vd, "abilities": handles(p, e, "m_vecAbilities", 24), "items": handles(p, e, "m_hItems", 17), "paused": rules.Get("m_pGameRules.m_bGamePaused")}
			if err := encode(states, state); err != nil {
				return err
			}
			samples++
		}
		summary["states"] = samples
		return nil
	})
	p.Callbacks.OnCMsgDOTACombatLogEntry(func(m *dota.CMsgDOTACombatLogEntry) error {
		if !m.GetIsAttackerHero() && !m.GetIsTargetHero() && m.GetType() != dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_BUYBACK {
			return nil
		}
		if rules == nil || m.Timestamp == nil {
			return nil
		}
		start, ok := numeric(rules.Get("m_pGameRules.m_flGameStartTime")).(float64)
		if !ok || start <= 0 {
			return nil
		}
		lookup := func(i uint32) string { n, _ := p.LookupStringByIndex("CombatLogNames", int32(i)); return n }
		r := Row{"t": float64(m.GetTimestamp()) - start, "tick": p.Tick, "type": m.GetType().String(), "attacker": lookup(m.GetAttackerName()), "target": lookup(m.GetTargetName()), "inflictor": lookup(m.GetInflictorName()), "value": m.GetValue(), "health": m.GetHealth(), "attacker_illusion": m.GetIsAttackerIllusion(), "target_illusion": m.GetIsTargetIllusion(), "target_hero": m.GetIsTargetHero(), "attacker_hero": m.GetIsAttackerHero(), "visibility_scope": "combat_event", "attacker_team": m.GetAttackerTeam(), "target_team": m.GetTargetTeam(), "visible_radiant": m.IsVisibleRadiant, "visible_dire": m.IsVisibleDire, "stun_duration": m.StunDuration, "silence": m.SilenceModifier, "root": m.RootModifier, "location_x": m.LocationX, "location_y": m.LocationY}
		if err := encode(events, r); err != nil {
			return err
		}
		nevents++
		summary["events"] = nevents
		return nil
	})
	return &summary
}
