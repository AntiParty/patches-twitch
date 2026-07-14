/**
 * Input Validation Middleware
 * Provides reusable validation functions for user inputs
 */

/**
 * Validate player ID format for THE FINALS.
 * Embark IDs run to 21 chars total: up to a 16-char name + '#' + 4 digits.
 */
export function isValidPlayerId(playerId: any): boolean {
    return (
        typeof playerId === "string" &&
        /^[a-zA-Z0-9_.#-]{3,21}$/.test(playerId)
    );
}

/**
 * Validate command name format
 */
export function isValidCommandName(name: any): boolean {
    return (
        typeof name === 'string' &&
        /^[a-zA-Z0-9_-]+$/.test(name) &&
        name.length > 0 &&
        name.length <= 50
    );
}

/**
 * Validate command response format
 */
export function isValidCommandResponse(response: any): boolean {
    return (
        // lock down response to 50 characters, and allow 0 characters
        typeof response === 'string' &&
        response.length <= 50 &&
        response.length >= 0
    );
}

/**
 * Validate rank number (1-6 for THE FINALS ranks)
 */
export function isValidRank(rank: any): boolean {
    return typeof rank === 'number' && rank >= 1 && rank <= 6;
}

/**
 * Validate rank score
 */
export function isValidRankScore(score: any): boolean {
    return typeof score === 'number' && score >= 0;
}