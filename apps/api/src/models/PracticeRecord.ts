import mongoose, { Schema, type Model } from "mongoose";

export type PracticeRecordDoc = {
  _id: mongoose.Types.ObjectId;
  kitId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  cardId: string;
  confidence: 1 | 2 | 3;
  seenCount: number;
  lastSeenAt: Date;
};

const practiceRecordSchema = new Schema<PracticeRecordDoc>(
  {
    kitId: { type: Schema.Types.ObjectId, ref: "Kit", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    cardId: { type: String, required: true },
    confidence: { type: Number, enum: [1, 2, 3], required: true },
    seenCount: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

practiceRecordSchema.index({ kitId: 1, cardId: 1 }, { unique: true });

export const PracticeRecord: Model<PracticeRecordDoc> =
  (mongoose.models.PracticeRecord as Model<PracticeRecordDoc>) ??
  mongoose.model<PracticeRecordDoc>("PracticeRecord", practiceRecordSchema);
