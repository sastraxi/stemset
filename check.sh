#!/bin/bash
set -e

pushd frontend
  bun tsc --noEmit
popd

uv run basedpyright

