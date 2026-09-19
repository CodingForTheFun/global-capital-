# Runtime release verification

Railway service: oblige-propline-training.
Only this dedicated service tracks chatgpt/propline-training-runtime-20260918.

Before configuring credentials, confirm deployment metadata points at this branch and the Python training commit. Railway's initial create-service deployment may use the repository default branch; redeploy repeats that original SHA rather than pulling the newly selected branch. A commit on the selected source branch triggers a fresh correct-source deployment.

The service start command is explicitly python -u /app/run.py and restart policy is NEVER. It has no domain and no production volume. The initial no-credential Python run must log WAITING_FOR_SECURE_CONFIGURATION with providerCalls=0.

Only after that verification, set PROPLINE_API_KEY and TRAINING_STORE_TOKEN on this new service using existing autoprop-live variable references. Never print resolved credential values. Confirm WEBSITE_SMOKE_PASSED, PRIVATE_STORAGE_VERIFIED, TRAINING_STARTED, real SPORT_DATA_VERIFIED counts and subsequent MARKET_TRAINING_RESULT logs. A deployment success alone is not evidence of training.

Report files and models remain in private Supabase storage. Inspect aggregate progress only. Do not automatically merge this branch's runtime Dockerfile into either website deployment branch.


## Automated factory schedule

The isolated Railway training service runs `factory.py` every six hours. Incomplete bootstrap or weekly cohorts resume from private checksummed checkpoints. After bootstrap completes, one stable ISO-week cohort uses a 180-day lookback ending at the previous completed Sunday. Provider quota reserves, request/time/byte bounds, strict held-out validation, and fail-closed unavailable behavior remain authoritative. A scheduled retry never widens customer polling and never fabricates or directly publishes a model.
