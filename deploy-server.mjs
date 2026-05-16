import express from "express";
import { exec } from "child_process";

const app = express();
app.use(express.json());

const DEPLOY_SECRET = process.env.DEPLOY_SECRET;

if (!DEPLOY_SECRET) {
    throw new Error("DEPLOY_SECRET is required to start the deploy server.");
}

app.post("/deploy", (req, res) => {
    const token = req.headers["x-deploy-token"];
    if (token !== DEPLOY_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
    }

    const cmd = "/bin/bash /home/antiparty/Desktop/FinalsRR/deploy.sh";

    exec(cmd, {
        env: { 
            PATH: "/usr/bin:/bin:/usr/local/bin:/usr/sbin:/sbin:/home/antiparty/.bun/bin" 
        }
    }, (err, stdout, stderr) => {
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        if (err) console.error(err);
    });

    res.json({ success: true, message: "Deployment started" });
});

app.listen(2500, "127.0.0.1", () => {
    console.log("Deploy server listening on localhost:2500");
});
