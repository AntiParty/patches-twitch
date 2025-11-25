# FinalsRS Bot - Commands Reference

Complete guide to all available commands for THE FINALS Twitch bot.

---

## 📊 Rank & Stats Commands

### `!rank` or `!r`
Shows your current rank and RS in THE FINALS.

**Example Output:**
```
@User, current rank is 48,234 RS in Diamond 1
```

**With Goal Set:**
```
@User, current rank is 48,234 RS in Diamond 1. 18,234 RS away from rank #100 (Ruby)
```

**With World Tour:**
```
@User, current rank is 48,234 RS in Diamond 1. 18,234 RS away from rank #100 (Ruby) | WT rank: #523
```

---

### `!record`
Shows your session progress (RS gained/lost since stream started).

**Example Output:**
```
@User, session progress: +2,341 RS (started at 45,893 RS)
```

---

### `!peak <player>`
Shows peak rank for a player across all seasons.

**Usage:**
```
!peak                    # Your peak rank
!peak PlayerName#1234    # Another player's peak
```

**Example Output:**
```
@User, peak rank: #234 Ruby (52,100 RS) in Season 7
```

---

## 🎯 Goal Commands

### `!goal <rank>`
Set a rank goal to track your progress.

**Usage:**
```
!goal 100        # Set goal to reach rank #100
!goal            # View current goal progress
```

**Example Output (Setting):**
```
@User, goal set to rank #100 (Ruby)! You need to climb 423 ranks and gain 18,234 RS. Let's go! 💪
```

**Example Output (Viewing):**
```
@User, Goal: Rank #100 (Ruby) | Current: #523 (Diamond 1, 48,234 RS) | 423 ranks to go, need 18,234 RS | Progress: 15.3%
```

**Aliases:** `!setgoal`, `!target`

---

## 🔗 Account Management

### `!link <player>`
Link your THE FINALS account to the bot.

**Usage:**
```
!link PlayerName#1234
```

**Example Output:**
```
@User, successfully linked to PlayerName#1234
```

---

### `!unlink`
Unlink your THE FINALS account from the bot.

**Example Output:**
```
@User, account unlinked successfully
```

---

## 🎨 Customization Commands

### `!editcmd <command> [response]`
Customize bot responses for specific commands.

**Usage:**
```
!editcmd rank                                    # View current custom response
!editcmd rank @{username}, #{rank} {league}     # Set custom response
!editcmd rank                                    # Remove custom response (back to default)
```

**Available Variables for `!rank`:**
- `{username}` — User's display name
- `{rank}` — Current rank number
- `{league}` — Current league (Ruby, Diamond, etc.)
- `{rankScore}` — Current RS value
- `{wtRank}` — World Tour rank
- `{found}` — 'true' if found, 'false' otherwise

**Available Variables for `!peak`:**
- `{rank}` — Peak rank number
- `{league}` — Peak league
- `{rankScore}` — Peak RS value
- `{season}` — Season of peak (e.g., "Season 7")
- `{wtRank}` — Peak World Tour rank
- `{wtSeason}` — World Tour season of peak

**Available Variables for `!record`:**
- `{username}` — User's display name
- `{sessionRS}` — RS gained/lost this session
- `{currentRS}` — Current total RS

**Example Custom Responses:**
```
!editcmd rank @{username} is grinding at #{rank} {league} with {rankScore} RS!
!editcmd peak Peak performance: #{rank} {league} in {season}!
!editcmd record Session grind: {sessionRS} RS gained!
```

---

## ℹ️ Information Commands

### `!commands`
Lists all available commands.

---

### `!help [command]`
Get help for a specific command.

**Usage:**
```
!help            # General help
!help rank       # Help for !rank command
!help goal       # Help for !goal command
```

---

## 🔧 Admin Commands

*(These commands are restricted to channel owner/mods)*

### `!resetdb`
**[ADMIN ONLY]** Reset the database (use with caution).

---

### `!wipesubs`
**[ADMIN ONLY]** Delete all EventSub subscriptions.

---

## 📝 Command Aliases

Many commands have shorter aliases for quick access:

| Command | Aliases |
|---------|---------|
| `!rank` | `!r` |
| `!goal` | `!setgoal`, `!target` |

---

## 💡 Tips & Best Practices

### For Streamers:
1. **Set a goal** at the start of your stream with `!goal <rank>`
2. **Customize responses** to match your brand with `!editcmd`
3. **Check progress** regularly with `!rank` to show viewers your journey
4. **Link your account** first with `!link PlayerName#1234`

### For Viewers:
1. Use `!rank` to see the streamer's current rank
2. Use `!goal` to see how close they are to their target
3. Use `!peak` to see their all-time best performance

---

## 🎯 Example Workflow

**Starting a Stream:**
```
1. !link PlayerName#1234          # Link your account (first time only)
2. !goal 100                       # Set today's goal
3. !rank                           # Show starting rank
```

**During Stream:**
```
!rank                              # Check current rank
!goal                              # Check goal progress
!record                            # See session progress
```

**End of Stream:**
```
!rank                              # Final rank
!record                            # Total session gains
!goal                              # Did you hit your goal?
```

---

## 🚀 Advanced Features

### Custom Response Templates

Create dynamic responses that change based on your stats:

**Example 1: Motivational Rank Response**
```
!editcmd rank @{username} is at {rankScore} RS in {league}! Keep grinding! 💪
```

**Example 2: Goal-Focused Response**
```
!editcmd rank Current: {rankScore} RS | Goal: Rank #100 | Let's get it!
```

**Example 3: Detailed Stats**
```
!editcmd rank #{rank} {league} ({rankScore} RS) | WT: #{wtRank} | Grinding to the top!
```

---

## ❓ FAQ

**Q: How often does the leaderboard update?**
A: The bot caches leaderboard data every 45 minutes.

**Q: Can I track multiple accounts?**
A: Currently, only one account can be linked per channel.

**Q: What happens if I achieve my goal?**
A: The bot will celebrate your achievement! You can then set a new goal.

**Q: Can viewers use these commands?**
A: Yes! Most commands are available to all viewers. Only admin commands are restricted.

**Q: How do I reset my custom responses?**
A: Use `!editcmd <command>` without a response to reset to default.

---

## 🆘 Support

If you encounter issues or have questions:
1. Check this documentation
2. Contact the bot developer
3. Visit the bot's website for more information

---

**Last Updated:** November 2025
**Bot Version:** 1.0.0
