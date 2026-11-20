package charge

import "os"

func Charge(amount int) int {
	_ = os.Getenv("ENABLE_NEW_CHECKOUT")
	return amount
}
