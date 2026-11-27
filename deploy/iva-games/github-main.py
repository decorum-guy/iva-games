#!/usr/bin/env python3
"""Runner preflight using the same authenticated API policy as the VPS."""

import os
import sys

import activation


try:
    sha = activation.github_json('branches/main', os.environ.get('REGISTRY_TOKEN', ''))['commit']['sha']
    if not activation.SHA.fullmatch(sha):
        raise RuntimeError('Invalid GitHub main revision')
    print(sha)
except (RuntimeError, KeyError, TypeError, ValueError) as error:
    # Only our sanitized errors go into Actions logs.
    print(str(error) if isinstance(error, RuntimeError) else 'Invalid GitHub response', file=sys.stderr)
    sys.exit(1)
