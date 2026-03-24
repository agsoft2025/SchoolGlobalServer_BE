const { default: mongoose } = require("mongoose");

const ParentSubscriptionHistorySchema = new mongoose.Schema(
  {
    student_id: {
      type: String,
      required: true
    },

    school_id: {
      type: String
    },

    subscription_type: {
      type: String,
      enum: ["MONTHLY", "QUARTERLY", "YEARLY"],
      required: true
    },

    amount: {
      type: Number,
      required: true
    },

    razorpay_order_id: {
      type: String,
      required: true
    },

    razorpay_payment_id: {
      type: String
    },

    payment_status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING"
    },

    activated_at: {
      type: Date,
      default: Date.now
    },

    expired_at: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("ParentSubscriptionHistory", ParentSubscriptionHistorySchema);
