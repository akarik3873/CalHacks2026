import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("delete expired telegram link codes", { hourUTC: 9, minuteUTC: 0 }, internal.telegram.deleteExpiredLinks);
export default crons;
