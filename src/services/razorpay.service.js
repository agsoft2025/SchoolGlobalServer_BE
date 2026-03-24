import razorpay from "../utils/razorpayInstance.js";

export async function createOrder(amount, receipt) {
  const options = {
    amount: amount * 100,
    currency: "INR",
    receipt,
  };

  return await razorpay.orders.create(options);
}
