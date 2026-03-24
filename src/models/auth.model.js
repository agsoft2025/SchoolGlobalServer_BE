const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {type:String,required: true},
    fullname: {type: String},
    password: {type:String,required: true},
    role: { type: String, required:true },
    location_id:{type:mongoose.Schema.Types.ObjectId ,ref:"InmateLocation"},
    inmateId:{type:String},
    descriptor:[Number],
    subscription:{type:Boolean,default:false},
     subscriptionStart: { type: Date },
    subscriptionEnd: { type: Date }, 

    otp:{type:String},
    otpExpiresAt: { type: Date },
    otpAttempts: { type: Number, default: 0 },
    otpAttemptedAt: { type: Date },
    otpLockedUntil: { type: Date }
},{timestamps: true});

const usermodel = mongoose.model('User',userSchema);
module.exports = usermodel