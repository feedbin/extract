#!/bin/bash

set -e

sha=$(shasum package-lock.json)
sha_file="deploy/package-lock.checksum"

run () {
    echo "Installing dependencies..."

    # Running twice fixes missing
    npm install --silent && npm install --silent

    echo "${sha}" > "${sha_file}"
}

if test -f "${sha_file}"; then
    old_sha=$(cat $sha_file)
    if [[ "${old_sha}" != "${sha}" ]]; then
        run
    fi
else
    run
fi

