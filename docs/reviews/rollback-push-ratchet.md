# Independent PR137 rollback review

Candidate 92b57be1, based on rollback/b24-kill-worker. Cleared the subscription/push preservation change.

Independently ran the author scenario in a fresh real Google Chrome profile, changing only the local port and temp-profile prefix for isolation. It registered the current PR138 service worker, subscribed using newly generated in-memory test keys, replaced /sw.js with the PR137 tombstone, and sent a real push through Google's service. The subscription survived; the tombstone was active; the push service returned 201; Chrome showed `Through the tombstone`.

The added push handlers match the live handler, and the tombstone retains its cache sweeps and no-fetch-handler behavior. This test does not claim a notification tap, Home Screen/iPhone, a deployed Worker or production-key validation. Keys and subscription credentials are not in the report/log.
