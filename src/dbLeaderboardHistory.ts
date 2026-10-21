import { Sequelize, DataTypes, Model } from "sequelize";
import path from "path";
import fs from "fs";

// Kept out of accounts.sqlite: this grows every leaderboard update and would
// otherwise bloat the main DB and its backups.
const dataDir = path.resolve(__dirname, "../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const storage = process.env.LEADERBOARD_HISTORY_DB
  ?? (process.env.NODE_ENV === "test" ? ":memory:" : path.resolve(dataDir, "leaderboard_history.sqlite"));

export const sequelizeHistory = new Sequelize({
  dialect: "sqlite",
  storage,
  logging: false,
  retry: {
    max: 3,
    match: [/SQLITE_BUSY/, /database is locked/],
  },
});

// One row per player each time their RS or league changes (plus first sighting).
export class LeaderboardHistory extends Model {
  declare id: number;
  declare season: number;
  declare player_key: string;
  declare player_name: string;
  declare player_uuid: string | null;
  declare rank: number;
  declare rank_score: number;
  declare league_number: number;
  declare club_tag: string;
  declare recorded_at: Date;
}

LeaderboardHistory.init(
  {
    season: { type: DataTypes.INTEGER, allowNull: false },
    player_key: { type: DataTypes.STRING, allowNull: false }, // lowercased Embark name
    player_name: { type: DataTypes.STRING, allowNull: false },
    player_uuid: { type: DataTypes.STRING, allowNull: true },
    rank: { type: DataTypes.INTEGER, allowNull: false },
    rank_score: { type: DataTypes.INTEGER, allowNull: false },
    league_number: { type: DataTypes.INTEGER, allowNull: false },
    club_tag: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    recorded_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize: sequelizeHistory,
    modelName: "LeaderboardHistory",
    tableName: "LeaderboardHistory",
    timestamps: false,
    indexes: [
      { fields: ["season", "player_key", "recorded_at"] },
      { fields: ["season", "recorded_at"] },
    ],
  }
);

export const historyDbReady = sequelizeHistory
  .query("PRAGMA journal_mode=WAL;")
  .then(() => sequelizeHistory.sync());
