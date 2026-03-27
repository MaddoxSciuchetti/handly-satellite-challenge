import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Step 1: frontend calls this to get a short-lived upload URL
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Returns all in_progress tasks with a signed image URL ready for processing
export const getPendingTasks = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .take(50);

    return await Promise.all(
      tasks.map(async (task) => ({
        taskId: task._id,
        imageUrl: await ctx.storage.getUrl(task.imageId),
        createdAt: task._creationTime,
      }))
    );
  },
});

// Step 2: frontend calls this after the image is uploaded, passing back the storageId
export const createTask = mutation({
  args: {
    imageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const taskId = await ctx.db.insert("tasks", {
      imageId: args.imageId,
      status: "in_progress",
    });
    return taskId;
  },
});
