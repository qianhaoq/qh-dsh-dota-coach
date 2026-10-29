package main

import (
	"bytes"
	"compress/bzip2"
	"github.com/klauspost/compress/zstd"
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
	for name, data := range map[string][]byte{"dem": raw, "zstd": compressed} {
		t.Run(name, func(t *testing.T) {
			out := filepath.Join(dir, name)
			os.MkdirAll(out, 0700)
			src := filepath.Join(dir, name+".input")
			os.WriteFile(src, data, 0600)
			path, meta, err := decode(src, out, 1000)
			if err != nil {
				t.Fatal(err)
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
	src := filepath.Join(dir, "zstd.input")
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
