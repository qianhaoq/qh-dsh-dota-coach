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
	return Row{"source": "demo match metadata", "timing": "metadata graphs and snapshots; not combat-log exact times", "players": players}
}
