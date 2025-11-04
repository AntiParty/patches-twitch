// src/commands/ping.ts
import os from "os";
import axios from "axios";
import fs from "fs/promises";
import { Channel } from "../db";
import logger from "@/util/logger";

export const execute = async (ctx) => {
  // Uptime
  const uptimeSec = Math.floor(process.uptime());
  const uptime = `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

  // Memory
  const mem = process.memoryUsage();
  const usedMB = Math.round(mem.rss / 1024 / 1024);
  const totalMB = Math.round(os.totalmem() / 1024 / 1024);

  // Pi Temperature
  let temp = "N/A";
  try {
    const raw = await fs.readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
    temp = `${(parseInt(raw, 10) / 1000).toFixed(1)}°C`;
  } catch {}

  // DB Health
  let dbHealth = "OK";
  try {
    await Channel.findOne({ where: {} });
  } catch {
    dbHealth = "ERROR";
  }
  await ctx.say(
    `Uptime: ${uptime} | Temp: ${temp} | Mem: ${usedMB}/${totalMB}MB | DB: ${dbHealth} `
  );
};

export const aliases = ["ping"];