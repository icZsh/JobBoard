# README screenshots

These images were captured from the running `feature/docker-self-hosting` application on September 5, 2026, at a 1280 × 720 browser viewport.

- `today.jpg`: completed automatic collection and the recommendation list.
- `setup.jpg`: first administrator setup before any credentials are entered.
- `settings.jpg`: daily schedule and expanded company sources.
- `board.jpg`: example cards in New, Interested, Applying and Applied.
- `review-to-board.gif`: three captured checkpoints of marking a role Interested in Today and finding it on the Board. Each checkpoint pauses for readability; this is not a continuous screen recording.

The capture used a separate Docker Compose project, database and files volume. Job listings came from a successful collection of the 18 public ATS boards. The account and application statuses are demonstration data; no applications were submitted and no personal account, resume or credentials appear in the images. Listings and availability will change over time.

To refresh these assets, use a separate local demo installation, collect public listings, and create example tracking states only in its database. Capture the actual UI without overlays or altered page content. Keep configuration files, cookies, raw source snapshots and any intermediate capture material out of Git. Preview every image and GIF before replacing the assets, then stop the demo services.
