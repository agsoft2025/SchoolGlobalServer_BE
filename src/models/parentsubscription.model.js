import mongoose from "mongoose";

const StudentSnapshotSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    registration_number: String,
    student_name: String,
    mother_name: String,
    father_name: String,
    contact_number: String,
    date_of_birth: Date,
    gender: String,
    nationality: String,
    blood_group: String,
    subscription: Boolean,
    class_info: mongoose.Schema.Types.ObjectId,
    location_id: mongoose.Schema.Types.ObjectId,
    user_id: mongoose.Schema.Types.ObjectId
  },
  { _id: false }
);


const ParentSubscriptionSchema = new mongoose.Schema(
  {
    student_id: {
      type: String
    },
    location_id: {
      type: String,
      ref:"Location",
      required:true
    },
    subscription_type: {
      type: String,
      enum: ["MONTHLY", "QUARTERLY", "YEARLY"],
      default: "MONTHLY"
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
      type: String,
    },

    payment_status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING"
    },

    start_date: {
      type: Date,
      default: Date.now
    },

    expire_date: {
      type: Date
    },

    is_active: {
      type: Boolean,
      default: false
    },
    student_info:StudentSnapshotSchema
  },
  {
    timestamps: true
  }
);

export default mongoose.model("ParentSubscription", ParentSubscriptionSchema);
