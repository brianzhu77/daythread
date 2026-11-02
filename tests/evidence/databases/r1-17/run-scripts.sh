#!/bin/zsh
# Every database browser script against a built app on a copy of his data. Run from the repo root. Each script's reseed
# starts from the copy instead of an empty store; the generated copies go in .r117/ and are removed at the end.
# Usage: run-scripts.sh <base-url> <store-path> <copy-of-his-data.sqlite> <log-dir>
if [[ $# -ne 4 ]]; then echo 'Usage: run-scripts.sh <base-url> <store-path> <copy-of-his-data.sqlite> <log-dir>'; exit 2; fi
base=$1; store=$2; copy=$3; out=$4; here=tests/evidence/databases; mkdir -p $here/.r117 $out
for f in $here/*.mjs; do sed -e "s#rm -f \${storePath} \&\& node $here/seed-table.ts#cp $copy \${storePath} \&\& node $here/seed-table.ts#" $f > $here/.r117/${f:t}; done
for s in table-edit keeps-place slash-database menu keys home-id cut-paste turn-into views notices offline-tabs row-actions rows-bulk kept-draft review-fixes phone-fields; do
  for e in chromium webkit; do
    case $s in table-edit|keeps-place|slash-database) cp $copy $store && node $here/seed-table.ts $store >/dev/null 2>&1;; esac
    node $here/.r117/$s.mjs $base $store $e > $out/$s-$e.log 2>&1; code=$?
    echo "$s $e exit=$code $(tail -1 $out/$s-$e.log | cut -c1-120)"
  done
done
rm -rf $here/.r117
