import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import logger from './logger';

const USERS_FILE = path.resolve(process.cwd(), 'data', 'users.json');

export interface SimpleUser {
    username: string;
    passwordHash: string;
    role: 'analyst' | 'admin';
    createdAt: string;
}

// Ensure file exists
if (!fs.existsSync(USERS_FILE)) {
    // Create directory if needed
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // Initialize with empty array
    fs.writeFileSync(USERS_FILE, '[]', 'utf8');
}

export async function getAllSimpleUsers(): Promise<SimpleUser[]> {
    try {
        if (!fs.existsSync(USERS_FILE)) return [];
        const content = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(content) as SimpleUser[];
    } catch (err) {
        logger.error('Failed to read users.json:', err);
        return [];
    }
}

export async function addSimpleUser(username: string, password: string, role: 'analyst' | 'admin' = 'analyst'): Promise<boolean> {
    try {
        const users = await getAllSimpleUsers();
        
        // Check if exists
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            return false; // Already exists
        }

        const passwordHash = await bcrypt.hash(password, 10);
        
        users.push({
            username,
            passwordHash,
            role,
            createdAt: new Date().toISOString()
        });

        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        return true;
    } catch (err) {
        logger.error('Failed to add simple user:', err);
        return false;
    }
}

export async function removeSimpleUser(username: string): Promise<boolean> {
    try {
        let users = await getAllSimpleUsers();
        const initialLength = users.length;
        
        users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());

        if (users.length === initialLength) return false; // Not found

        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        return true;
    } catch (err) {
        logger.error('Failed to remove simple user:', err);
        return false;
    }
}

export async function verifySimpleLogin(username: string, password: string): Promise<SimpleUser | null> {
    try {
        const users = await getAllSimpleUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return user;
    } catch (err) {
        logger.error('Failed to verify simple login:', err);
        return null;
    }
}
