#!/bin/bash

# Helper script to ensure Bun is being used
if command -v bun &> /dev/null; then
    echo "Using Bun version: $(bun --version)"
else
    echo "Error: Bun not found. Please install Bun from https://bun.sh"
    exit 1
fi