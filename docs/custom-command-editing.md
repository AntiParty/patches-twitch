
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
!editcmd rank FinalsRR: @{username}, #{rank} {league} - {rankScore} RS | WT rank: #{wtRank}
```

*Now, when someone uses `!rank`, your bot will reply with that message, filling in the details for each user!*

You can use these special words in curly braces, and the bot will fill them in:

- `{username}` — The user’s name
- `{rank}` — Their rank
- `{league}` — Their league
- `{rankScore}` — Their rank score
- `{wtRank}` — Their World Tour rank
- `{found}` — 'true' if found, 'false' otherwise

---

## 3. Go Back to the Default Message

Want to remove your custom message and use the bot’s normal reply?

Just type:

```
!editcmd rank
```

---

## 4. Customize Other Commands

You can do this for any command that supports custom messages, like `!record`:

```
!editcmd record @{username}, your session RS is {sessionRS} ({currentRS} RS)
```

---

## 5. Example: Full Workflow

1. Type `!editcmd rank FinalsRR: @{username}, #{rank} {league} - {rankScore} RS | WT rank: #{wtRank}` in chat.
2. Use `!rank` and see your custom message in action.
3. Change it anytime with another `!editcmd rank ...` command.
4. Remove it with `!editcmd rank` to go back to default.

---

## Tips

- Only channel owners/mods should use this feature for security.
- Variables available depend on the command. See above for `rank` and `record`.
- If no custom response is set, the bot uses its default reply.

---

For more info, visit your bot’s documentation site or contact the developer.