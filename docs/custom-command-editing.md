

# How to Customize Bot Commands (Easy Guide)

Want your bot to say exactly what you want for commands like `!rank` or `!record`? You can! Just use the `!editcmd` command in your chat. Here’s how:

---

## 1. See What Your Bot Will Say

Type this in chat to see the current custom message for a command:

```
!editcmd rank
```
*This shows what your bot will say for `!rank` in your channel.*

---

## 2. Change What Your Bot Says (Set a Custom Message)

Type this in chat:

```
!editcmd rank @{username}, #{rank} {league} - {rankScore} RS | WT rank: #{wtRank}
```

*Now, when someone uses `!rank`, your bot will reply with that message, filling in the details for each user!*


```
!editcmd peak Peak rank: #{rank} {league} ({rankScore} RS) in {season} | WT peak: #{wtRank} in {wtSeason}
```

Available variables for `!peak`:
- `{rank}` — Peak regular season rank
- `{league}` — Peak regular season league
- `{rankScore}` — Peak regular season RS
- `{season}` — Peak regular season (e.g. "Season 4")
- `{wtRank}` — Peak World Tour rank
- `{wtSeason}` — Peak World Tour season (e.g. "World Tour Season 6")

If only one is found, the bot will fill in just that part.

---

## 3. Go Back to the Default Message

Want to remove your custom message and use the bot’s normal reply?

Just type:

```
!editcmd rank
```

---

## 4. Customize Other Commands


You can do this for any command that supports custom messages, like `!record` or `!peak`:

```
!editcmd record @{username}, your session RS is {sessionRS} ({currentRS} RS)
!editcmd peak Peak rank: #{rank} {league} ({rankScore} RS) in {season} | WT peak: #{wtRank} in {wtSeason}
```

---

## 5. Example: Full Workflow


1. Type `!editcmd rank @{username}, #{rank} {league} - {rankScore} RS | WT rank: #{wtRank} TEST EDIT` in chat.
2. Type `!editcmd peak Peak rank: #{rank} {league} ({rankScore} RS) in {season} | WT peak: #{wtRank} in {wtSeason}` in chat.
3. Use `!rank` or `!peak` and see your custom message in action.
4. Change it anytime with another `!editcmd rank ...` or `!editcmd peak ...` command.
5. Remove it with `!editcmd rank` or `!editcmd peak` to go back to default.

---

## Tips

- Only channel owners/mods should use this feature for security.
- Variables available depend on the command. See above for `rank` and `record`.
- If no custom response is set, the bot uses its default reply.

---

For more info, visit your bot’s documentation site or contact the developer.