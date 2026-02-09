import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Configure rotating file transports to prevent unbounded log file growth
const errorRotateTransport: DailyRotateFile = new DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '10m',      // Rotate when file exceeds 10MB
  maxFiles: '7d',      // Keep logs for 7 days
  zippedArchive: true, // Compress old files
});

const combinedRotateTransport: DailyRotateFile = new DailyRotateFile({
  filename: 'logs/combined-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',      // Rotate when file exceeds 20MB
  maxFiles: '7d',      // Keep logs for 7 days
  zippedArchive: true, // Compress old files
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}${stack ? '\n' + stack : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    errorRotateTransport,
    combinedRotateTransport,
  ],
});

export default logger;