package main

import "github.com/dotabuff/manta"

// One clock for entity observations; combat timestamps already exclude pauses.
type matchClock struct {
	rules    *manta.Entity
	tick     uint32
	interval float64
	basis    Row
}

func newClockBasis() Row {
	return Row{"name": "server_tick_pause_adjusted", "unit": "seconds", "zero": "horn_game_start", "pregame": "negative", "entity_formula": "(server_tick - total_paused_ticks - active_pause_ticks) * tick_interval - game_start_time", "combat_formula": "combat_timestamp - game_start_time", "pause_handling": "completed_and_active_pause_ticks_excluded", "pause_observed": nil, "total_paused_ticks": nil, "game_end": nil}
}
func (c *matchClock) now() (float64, bool) {
	if c.rules != nil {
		if n, ok := asInt(c.rules.Get("m_pGameRules.m_nTotalPausedTicks")); ok {
			c.basis["total_paused_ticks"] = n
			if n > 0 {
				c.basis["pause_observed"] = true
			}
		}
		if paused, ok := c.rules.Get("m_pGameRules.m_bGamePaused").(bool); ok {
			if c.basis["pause_observed"] != true {
				c.basis["pause_observed"] = paused
			}
		}
		c.basis["tick_interval"] = c.interval
		c.basis["game_start_time"] = numeric(c.rules.Get("m_pGameRules.m_flGameStartTime"))
	}
	return gameClock(c.tick, c.interval, c.rules)
}
func (c *matchClock) observeEnd(row Row) {
	if row["type"] != "DOTA_COMBATLOG_TEAM_BUILDING_KILL" {
		return
	}
	target := row["target"]
	if target == "npc_dota_goodguys_fort" || target == "npc_dota_badguys_fort" {
		c.basis["game_end"] = Row{"t": row["t"], "source": "DOTA_COMBATLOG_TEAM_BUILDING_KILL", "target": target}
	}
}

func objectiveRow(now func() (float64, bool), kind, building, id string) Row {
	row := Row{"what": kind, "building_id": building, "entity_id": id, "t": nil}
	if t, known := now(); known {
		row["t"] = t
	}
	return row
}
