# AWS static hosting

This stack serves the game from a private S3 bucket through CloudFront. It keeps
S3 Block Public Access enabled, redirects viewers to HTTPS, compresses assets,
and resolves `/2d/` and `/3d/` to their `index.html` files.

## Default CloudFront address

Authenticate the AWS CLI, then run from the repository root:

```bash
chmod +x scripts/deploy-aws.sh
./scripts/deploy-aws.sh fc26-game
```

The command prints an address such as `https://d123example.cloudfront.net`.

## Custom domain

The domain must already have a public Route 53 hosted zone in the same AWS
account. Deploy in `us-east-1` so ACM can issue a certificate for CloudFront:

```bash
AWS_REGION=us-east-1 ./scripts/deploy-aws.sh \
  fc26-game play.example.com Z0123456789EXAMPLE
```

CloudFormation creates the certificate, DNS validation record, CloudFront alias,
and Route 53 A alias. Re-run the same command to publish later game updates.

The S3 bucket is retained if the stack is deleted, protecting deployed game
files from accidental removal. Delete the retained bucket manually only when it
is no longer needed.
