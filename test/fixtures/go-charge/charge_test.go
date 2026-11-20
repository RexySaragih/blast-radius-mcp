package charge

import "testing"

func TestCharge(t *testing.T) {
	if Charge(1) != 1 {
		t.Fatal("expected 1")
	}
}
