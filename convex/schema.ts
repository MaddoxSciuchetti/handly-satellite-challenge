import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    status: v.union(v.literal("in_progress"), v.literal("done")),
    imageId: v.id("_storage"),
    // Embedded graph — written by the Python backend when processing is done
    nodes: v.optional(v.array(v.object({ x: v.number(), y: v.number() }))),
    edges: v.optional(v.array(v.object({ from: v.number(), to: v.number() }))),
  }).index("by_status", ["status"]),
});
