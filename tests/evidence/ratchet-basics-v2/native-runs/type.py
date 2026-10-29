import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
ctx('NATIVE_APP')
for x in 'wan':key(x)
time.sleep(.4);Path('/tmp/ratchet229-candidates.xml').write_text(call('source',method='GET'));shot('candidates')
