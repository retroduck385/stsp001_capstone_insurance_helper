const express = require("express");
const { spawn } = require("child_process");
const path = require("path");

const router = express.Router();

router.post("/:claimId/assessment", (req, res) => {
    const claimId = req.params.claimId;

    const pythonScript = path.join(
        __dirname,
        "../../scripts/policy_crosschecker.py"
    );

    const python = spawn("python", [
        pythonScript,
        claimId
    ]);

    let output = "";
    let errorOutput = "";

    python.stdout.on("data", (data) => {
        output += data.toString();
    });

    python.stderr.on("data", (data) => {
        errorOutput += data.toString();
    });

    python.on("close", (code) => {
        if (code !== 0) {
            console.error("Python error:", errorOutput);

            return res.status(500).json({
                error: "Assessment failed",
                details: errorOutput
            });
        }

        try {
            const result = JSON.parse(output);

            return res.json(result);
        } catch (error) {
            console.error("Invalid Python output:", output);

            return res.status(500).json({
                error: "Python returned invalid JSON",
                output
            });
        }
    });
});

module.exports = router;