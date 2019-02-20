#!/bin/bash

set -e

sha=$(shasum package-lock.json)
sha_file=package-lock.checksum

run () {
    echo "run"
    # npm install --save --quiet

    # Running twice fixes missing
    # npm install --save --quiet

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

