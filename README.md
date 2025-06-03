# Self‑Contained TikTok Gift Tracker

A single‑container app that monitors gifts for one TikTok username
and serves a password‑protected dashboard.

## Build

```bash
docker build -t gift-tracker .
```

## Run

```bash
docker run -it --rm -p 3000:3000 \
  -e TIKTOK_USERNAME=best_family05 \
  -e DASH_PASSWORD=supersecret \
  gift-tracker
```

Then open http://localhost:3000 and authenticate with:

* **user**: `admin`
* **pass**: whatever you set in `DASH_PASSWORD`

## Editing gift groups

* Modify `config/groups.json` before building, or
* Mount your own file:

  ```bash
  docker run -v $(pwd)/groups.json:/app/config/groups.json:ro ...
  ```

```jsonc
{
  "roses": {
    "name": "Roses",
    "giftIds": [5655],
    "goal": 1000,
    "color": "#ff0066"
  }
}
```

## Notes

* Counters are in‑memory only. Persist to disk if needed.
* Dashboard CSS/JS is deliberately minimal – tweak as you like.
* Deploy this same image anywhere Docker runs (VM, on‑prem, Cloud Run, ECS).

# PROD Release


## Build and PUSH
* from the repo root
gcloud builds submit --tag us-central1-docker.pkg.dev/o3-tt-subscription/gift-containers/gift-tracker:latest

## Cloud Run service per Tiktok Username
USER=best_family05
PASS=$(openssl rand -base64 12)      

gcloud run deploy gift-yala-ss2 \
  --image us-central1-docker.pkg.dev/o3-tt-subscription/gift-containers/gift-tracker:v0.6 \
  --region us-central1 \
  --memory 256Mi --min-instances 1 --max-instances 3 \
  --set-env-vars TIKTOK_USERNAME=${USER},DASH_PASSWORD=${PASS} \
  --allow-unauthenticated

## PAUSE/Suspend
gcloud run services update gift-${USER} --min-instances 0 --region us-central1

## RESUME 
gcloud run services update gift-${USER} --min-instances 1 --region us-central1

## Change TikTok Username
gcloud run services update gift-${USER} --set-env-vars TIKTOK_USERNAME=newUser --region us-central1

## Upgrade to new image
gcloud run services update gift-${USER} --image ...:v0.4 --region us-central1

## DELETE
gcloud run services delete gift-yala-ss2 --region us-central1


