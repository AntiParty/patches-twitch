// db.ts
import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'mysql',
  logging: false,
});

// Define the Channel model with player_id field
class Channel extends Model {}
// db.ts
Channel.init(
  {
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    player_id: {
      type: DataTypes.STRING,
      allowNull: true, // Player ID can be null initially
      defaultValue: null,
    },
    access_token: {
      type: DataTypes.STRING,
      allowNull: true, // Access token will be set after authorization
    },
    refresh_token: {
      type: DataTypes.STRING,
      allowNull: true, // Refresh token to renew expired access tokens
    },
  },
  { sequelize, modelName: 'Channel' }
);

// Sync the database without overwriting the data
sequelize.sync().then(() => console.log('Database synced.'));

// Export the sequelize instance and Channel model
export { sequelize, Channel };
