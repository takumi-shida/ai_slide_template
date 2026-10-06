# Instruction-only host setup

Copy or reference the chosen skill from skills/create-slides/ or skills/prepare-slide-template/ in the host's supported instruction/skill location. Keep existing project instructions. Use a separately installed CLI checkout, and explicitly select the private template pack.

This is an instruction-only fallback for hosts such as Cursor, Cline, Windsurf, Aider, Kiro, and others. It does not grant shell execution, local file access, Google authorization, or model usage. Cloud agents cannot automatically read a user's laptop. Verify those capabilities and record host/OS/version before advertising full support.

Do not add always-on hooks or broad model-context injection merely to expose slide workflows. Normal ChatGPT/Claude Web can use a copied prompt and the Slides sidebar; installing a local plugin alone does not bridge the Web session to the user's laptop.
