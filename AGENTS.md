# Development instructions

- Keep schemas, capacity/evidence validation, and diff logic in the environment-independent core.
- Preserve existing page layouts; AI supplies registered content, not arbitrary coordinates, scripts, or fonts.
- Company Gemini is Web-only. Do not require a model API, Gemini CLI, Workspace Studio, or a personal SaaS.
- Put real templates, customer data, credentials, and generated deployments outside public source (private-packs/ and work/ are ignored).
- Run npm run check and relevant CLI integration tests. Mock Slides tests do not prove actual Google rendering or installed host compatibility.
- Keep requirements and capability status honest: implemented, locally tested, host-tested, and planned are different states.
- Do not automatically approve templates, bypass host permissions, deploy Google projects, or merge pull requests without authorization for those actions.
