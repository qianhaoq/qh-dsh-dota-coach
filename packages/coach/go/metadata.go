package main

import "github.com/dotabuff/manta/dota"

// Explicit allowlist: never serialize the source metadata or private metadata.
// Graphs and inventory snapshots are demo match metadata, not combat events.
func matchMetadataRow(m *dota.CDOTAMatchMetadataFile) Row {
	players := []Row{}
	for _, team := range m.GetMetadata().GetTeams() {
		for _, p := range team.GetPlayers() {
			items := []Row{}
			for _, item := range p.GetItems() {
				items = append(items, Row{"item_id": item.ItemId, "purchase_time": item.PurchaseTime})
			}
			snapshots := []Row{}
			for _, snap := range p.GetInventorySnapshot() {
				snapshots = append(snapshots, Row{"game_time": snap.GameTime, "last_hits": snap.LastHits, "denies": snap.Denies, "level": snap.Level, "kills": snap.Kills, "deaths": snap.Deaths, "assists": snap.Assists})
			}
			players = append(players, Row{"player_slot": p.PlayerSlot, "dota_team": team.DotaTeam, "team_number": p.TeamNumber, "team_slot": p.TeamSlot, "game_player_id": p.GamePlayerId, "graph_net_worth": p.GetGraphNetWorth(), "camps_stacked": p.CampsStacked, "items": items, "inventory_snapshots": snapshots})
		}
	}
	row := Row{"source": "demo match metadata", "timing": "metadata graphs and snapshots; not combat-log exact times", "players": players}
	if id := m.GetMatchId(); id != 0 {
		row["match_id"] = id
	}
	return row
}

// Only selected hero unit keys are joined; missing identity remains unknown.
func attachMetadataHeroes(row Row, keys map[int]string) {
	for _, player := range row["players"].([]Row) {
		player["hero_key"] = nil
		if id, ok := player["game_player_id"].(*int32); ok && id != nil {
			if hero := keys[int(*id)]; hero != "" {
				player["hero_key"] = hero
				player["hero_identity_source"] = "player_resource_selected_handle"
			}
		}
	}
}
