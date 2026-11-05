import { Sequelize, DataTypes, Model } from "sequelize";
import path from "path";
import fs from "fs";
import logger from "@/util/logger";

// Balance/TTK data (weapon stats, patch notes, review queue) lives in its own
// SQLite file so it can be wiped/rebuilt from the wiki without touching accounts.sqlite.
const dataDir = path.resolve(__dirname, "../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const storage = process.env.BALANCE_DB
  ?? (process.env.NODE_ENV === "test" ? ":memory:" : path.resolve(dataDir, "balance.sqlite"));

export const sequelizeBalance = new Sequelize({
  dialect: "sqlite",
  storage,
  logging: false,
  retry: {
    max: 3,
    match: [/SQLITE_BUSY/, /database is locked/],
  },
});

// Weekly patch notes -> weapon stats -> TTK (see services/balanceReview.service.ts).
// New tables only, so sequelize.sync() creates them; no migration needed.
class WeaponStat extends Model {
  declare name: string;
  declare build: string | null;
  declare wtype: string | null;
  declare data: string;              // JSON of WeaponStats (services/weaponStats.ts)
  declare source: string;            // 'wiki' | 'manual'
  declare updated_from: string | null; // e.g. "Update 12.2.0" or "wiki"
  declare updated_at: Date;
}

WeaponStat.init(
  {
    name: { type: DataTypes.STRING, primaryKey: true },
    build: { type: DataTypes.STRING, allowNull: true },
    wtype: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.TEXT, allowNull: false },
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'wiki' },
    updated_from: { type: DataTypes.STRING, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize: sequelizeBalance, modelName: 'WeaponStat', tableName: 'WeaponStats', timestamps: false }
);

class ClassHealthStat extends Model {
  declare build: string;
  declare health: number;
  declare updated_from: string | null;
  declare updated_at: Date;
}

ClassHealthStat.init(
  {
    build: { type: DataTypes.STRING, primaryKey: true },
    health: { type: DataTypes.INTEGER, allowNull: false },
    updated_from: { type: DataTypes.STRING, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize: sequelizeBalance, modelName: 'ClassHealthStat', tableName: 'ClassHealthStats', timestamps: false }
);

class PatchNote extends Model {
  declare gid: string;
  declare title: string;
  declare url: string;
  declare posted_at: Date;
  declare status: string;            // 'baseline' | 'no_balance' | 'pending' | 'reviewed'
  declare unparsed: string | null;   // JSON array of balance lines we couldn't read
  declare created_at: Date;
}

PatchNote.init(
  {
    gid: { type: DataTypes.STRING, primaryKey: true },
    title: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    url: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    posted_at: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
    unparsed: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize: sequelizeBalance, modelName: 'PatchNote', tableName: 'PatchNotes', timestamps: false }
);

class BalanceChange extends Model {
  declare id: number;
  declare source: string;            // 'patch' | 'wiki'
  declare patch_gid: string | null;
  declare kind: string;              // 'weapon' | 'class' | 'other'
  declare target: string;
  declare raw_target: string | null;
  declare field: string | null;
  declare stat_label: string;
  declare from_value: number | null;
  declare to_value: number;
  declare current_value: number | null;
  declare raw_line: string | null;
  declare status: string;            // 'pending' | 'applied' | 'rejected' | 'info'
  declare from_mismatch: boolean;
  declare confirmed_by_wiki: boolean;
  declare confirmed_by_patch: boolean;
  declare decided_by: string | null;
  declare decided_at: Date | null;
  declare created_at: Date;
}

BalanceChange.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    source: { type: DataTypes.STRING, allowNull: false },
    patch_gid: { type: DataTypes.STRING, allowNull: true },
    kind: { type: DataTypes.STRING, allowNull: false },
    target: { type: DataTypes.STRING, allowNull: false },
    raw_target: { type: DataTypes.STRING, allowNull: true },
    field: { type: DataTypes.STRING, allowNull: true },
    stat_label: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    from_value: { type: DataTypes.FLOAT, allowNull: true },
    to_value: { type: DataTypes.FLOAT, allowNull: false },
    current_value: { type: DataTypes.FLOAT, allowNull: true },
    raw_line: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
    from_mismatch: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    confirmed_by_wiki: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    confirmed_by_patch: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    decided_by: { type: DataTypes.STRING, allowNull: true },
    decided_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: sequelizeBalance,
    modelName: 'BalanceChange',
    tableName: 'BalanceChanges',
    timestamps: false,
    indexes: [{ fields: ['status'] }, { fields: ['patch_gid'] }],
  }
);

// Tiny key/value store for the watcher (last wiki sync, last poll, skipped wiki pages).
class BalanceMeta extends Model {
  declare key: string;
  declare value: string;
}

BalanceMeta.init(
  {
    key: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  },
  { sequelize: sequelizeBalance, modelName: 'BalanceMeta', tableName: 'BalanceMeta', timestamps: false }
);

export { WeaponStat, ClassHealthStat, PatchNote, BalanceChange, BalanceMeta };

export const balanceDbReady = sequelizeBalance
  .query("PRAGMA journal_mode=WAL;")
  .then(() => sequelizeBalance.query("PRAGMA busy_timeout=5000;"))
  .then(() => sequelizeBalance.sync())
  .then(() => logger.info("[balanceDb] ready"))
  .catch((error) => {
    logger.error("[balanceDb] failed:", error);
    throw error;
  });
