package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/dotabuff/manta/dota"
	"google.golang.org/protobuf/proto"
)

func TestKeepCombatEntry(t *testing.T) {
	for n, name := range dota.DOTA_COMBATLOG_TYPES_name {
		typ := dota.DOTA_COMBATLOG_TYPES(n)
		m := &dota.CMsgDOTACombatLogEntry{Type: &typ}
		want := map[string]bool{"DOTA_COMBATLOG_BUYBACK": true, "DOTA_COMBATLOG_PURCHASE": true, "DOTA_COMBATLOG_GOLD": true, "DOTA_COMBATLOG_XP": true, "DOTA_COMBATLOG_PLAYERSTATS": true, "DOTA_COMBATLOG_TEAM_BUILDING_KILL": true, "DOTA_COMBATLOG_FIRST_BLOOD": true}[name]
		if keepCombatEntry(m) != want {
			t.Errorf("filter %s", name)
		}
		m.IsAttackerHero = proto.Bool(true)
		if !keepCombatEntry(m) {
			t.Errorf("attacker hero %s", name)
		}
		m.IsAttackerHero = nil
		m.IsTargetHero = proto.Bool(true)
		if !keepCombatEntry(m) {
			t.Errorf("target hero %s", name)
		}
	}
}

func TestCombatRowNamesAndPresence(t *testing.T) {
	m := &dota.CMsgDOTACombatLogEntry{Type: dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_PURCHASE.Enum(), Timestamp: proto.Float32(90), AttackerName: proto.Uint32(1), TargetName: proto.Uint32(2), InflictorName: proto.Uint32(3), Value: proto.Uint32(4), LastHits: proto.Uint32(0), Networth: proto.Uint32(500), Gpm: proto.Uint32(300), Xpm: proto.Uint32(400), GoldReason: proto.Uint32(2), XpReason: proto.Uint32(3), BuildingType: proto.Uint32(1), IsTargetBuilding: proto.Bool(false)}
	names := map[uint32]string{1: "attacker", 2: "npc_dota_hero_hoodwink", 3: "inflictor", 4: "item_ward_dispenser"}
	row := combatRow(m, 12, 100, func(i uint32) string { return names[i] })
	if row["t"] != float64(-10) || row["value"] != uint32(4) {
		t.Fatal(row)
	}
	for key, want := range map[string]string{"attacker": names[1], "target": names[2], "inflictor": names[3], "value_name": names[4]} {
		if row[key] != want {
			t.Fatal(key, row)
		}
	}
	b, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]interface{}
	json.Unmarshal(b, &decoded)
	for _, key := range []string{"last_hits", "networth", "gpm", "xpm", "gold_reason", "xp_reason", "building_type", "is_target_building"} {
		if decoded[key] == nil {
			t.Fatal(key, string(b))
		}
	}
	if decoded["location_x"] != nil || decoded["location_y"] != nil {
		t.Fatal(string(b))
	}
}

func TestMatchMetadataAllowlist(t *testing.T) {
	m := &dota.CDOTAMatchMetadataFile{PrivateMetadata: []byte("PRIVATE_SENTINEL"), Metadata: &dota.CDOTAMatchMetadata{Teams: []*dota.CDOTAMatchMetadata_Team{{DotaTeam: proto.Uint32(2), Players: []*dota.CDOTAMatchMetadata_Team_Player{{PlayerSlot: proto.Uint32(0), TeamSlot: proto.Uint32(0), GamePlayerId: proto.Int32(0), GraphNetWorth: []float32{100, 200}, CampsStacked: proto.Uint32(2), Items: []*dota.CDOTAMatchMetadata_Team_ItemPurchase{{ItemId: proto.Int32(42), PurchaseTime: proto.Int32(-60)}}, InventorySnapshot: []*dota.CDOTAMatchMetadata_Team_InventorySnapshot{{GameTime: proto.Int32(600), LastHits: proto.Uint32(80), ItemId: []int32{999999}}}}}}, {}}}}
	row := matchMetadataRow(m)
	players := row["players"].([]Row)
	if len(players) != 1 || len(players[0]["graph_net_worth"].([]float32)) != 2 {
		t.Fatal(row)
	}
	b, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"PRIVATE_SENTINEL", "999999", "steam", "player_name", "cosmetic"} {
		if strings.Contains(string(b), forbidden) {
			t.Fatal(string(b))
		}
	}
	if !strings.Contains(string(b), `"game_time":600`) || !strings.Contains(string(b), `"purchase_time":-60`) {
		t.Fatal(string(b))
	}
	if len(matchMetadataRow(nil)["players"].([]Row)) != 0 {
		t.Fatal("nil metadata")
	}
}
