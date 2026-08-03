'use strict';
const { parseNpuSmi } = require('./parser.js');

let failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log('  PASS  ' + name);
  } else {
    console.log('  FAIL  ' + name);
    console.log('         expected: ' + e);
    console.log('         actual:   ' + a);
    failed++;
  }
}

const SAMPLE_ASCEND = `+----------------------------+--------------------+--------+----------------------+
| NPU   Name                 | Health             | Power(W)| Temp(C)             |
+============================+====================+========+======================+
| 0     910B                 | OK                 | 91.7   | 46                  |
| 1     910B                 | OK                 | 88.2   | 45                  |
+----------------------------+--------------------+--------+----------------------+
| NPU   Chip                 | Memory-Usage(MiB)  | HBM-Usage(MiB)       | Util |
+============================+====================+====================+======+
| 0     0                    | 23456 / 65536      | 0 / 0                | 78   |
| 1     0                    | 12340 / 65536      | 0 / 0                | 12   |
+---------------------------+--------------------+--------------------+------+`;

const { npus } = parseNpuSmi(SAMPLE_ASCEND);
eq('ascend: count', npus.length, 2);
eq('ascend: npu 0 util', npus[0] && npus[0].util, 78);
eq('ascend: npu 0 memUsed', npus[0] && npus[0].memoryUsed, 23456);
eq('ascend: npu 0 memTotal', npus[0] && npus[0].memoryTotal, 65536);
eq('ascend: npu 1 util', npus[1] && npus[1].util, 12);

const SINGLE_LINE = `| 0     310P                 | OK                 | 50.0   | 40                  |`;
const { npus: npus2 } = parseNpuSmi(SINGLE_LINE);
eq('single line: count (no chip row => empty)', npus2.length, 0);

const USAGES = `+--------------------------------------------------------------------------------+
| npu-smi 22.0.5.5                    Version: 22.0.5.5                           |
+-------------------------------------------+-----------+--------+---------------+
| NPU     Name                              | Health    | Power(W) | Temp(C)     |
| Chip    Device                           | Bus-Id    | Memory-Usage | Util-Gpu  |
+===========================================+===========+========+================+
| 0       910B                             | OK        | 91.7    | 46          |
| 0       0                                | 0000:01:00.0 | 23456 / 65536 | 88      |
| 1       910B                             | OK        | 88.2    | 45          |
| 1       0                                | 0000:02:00.0 | 12340 / 65536 | 22      |
+-------------------------------------------+-----------+--------+---------------+`;
const { npus: npusUsages } = parseNpuSmi(USAGES);
eq('usages: count', npusUsages.length, 2);
eq('usages: npu 0 util', npusUsages[0] && npusUsages[0].util, 88);
eq('usages: npu 1 util', npusUsages[1] && npusUsages[1].util, 22);

const JSON_OUT = JSON.stringify([
  { npu_id: 0, name: '910B', util: 78, memory: { used: 23456, total: 65536 } },
  { npu_id: 1, name: '910B', util: 12, memory: { used: 12340, total: 65536 } },
]);
const { npus: npusJson } = parseNpuSmi(JSON_OUT);
eq('json: count', npusJson.length, 2);
eq('json: npu 0 util', npusJson[0] && npusJson[0].util, 78);
eq('json: npu 0 mem', npusJson[0] && npusJson[0].memoryUsed, 23456);

const USAGES_BLOCK = `NPU ID : 0
Memory Usage(MB) : 23456 / 65536
Utilization(%) : 78

NPU ID : 1
Memory Usage(MB) : 12340 / 65536
Utilization(%) : 12`;
const { npus: npusBlock } = parseNpuSmi(USAGES_BLOCK);
eq('usages block: count', npusBlock.length, 2);
eq('usages block: npu 0 util', npusBlock[0] && npusBlock[0].util, 78);

const GARBAGE = `random text\nno pipes here\nnothing relevant`;
const { npus: npus3 } = parseNpuSmi(GARBAGE);
eq('garbage: count', npus3.length, 0);

const EMPTY = '';
const { npus: npus4 } = parseNpuSmi(EMPTY);
eq('empty: count', npus4.length, 0);

const ASCEND_25 = `+------------------------------------------------------------------------------------+
| npu-smi 25.5.1                    Version: 25.5.1                                    |
+------------------------------------------------------------------------------------+
| NPU     Name                | Health      | Power(W)  Temp(C)        Hugepages-Usage(page)|
| Chip    Phy-Id              | Bus-Id      | AICore(%) Memory-Usage(MB)     HBM-Usage(MB)   |
+============================+==============+============================+=================+
| 0     Ascend910            | OK          | 171.3       41                0    /   0        |
| 0     0                    | 0000:9D:00.0 |   0          0      /   0      46904 / 65536   |
+------------------------------------------------------------------------------------+
| 0     Ascend910            | OK          | -          43                0    /   0        |
| 1     1                    | 0000:9F:00.0 |   0          0      /   0      46582 / 65536   |
+------------------------------------------------------------------------------------+
| 1     Ascend910            | OK          | 160.4       43                0    /   0        |
| 0     2                    | 0000:99:00.0 |   0          0      /   0      3123 / 65536    |
+------------------------------------------------------------------------------------+
| 1     Ascend910            | OK          | -          40                0    /   0        |
| 1     3                    | 0000:9B:00.0 |   0          0      /   0      2875 / 65536    |
+------------------------------------------------------------------------------------+
| 2     Ascend910            | OK          | 157.5       43                0    /   0        |
| 0     4                    | 0000:95:00.0 |   0          0      /   0      3120 / 65536    |
+------------------------------------------------------------------------------------+
| NPU     Chip                | Process id   | Process name      | Process memory(MB) |
+============================+==============+============================+=================+
| 0     0                    | 3101668      | /home/rjw/sglang-k3/python | 43767              |
| 0     0                    | 3100667      | /home/lp/sglang/server.py | 112                |
| 1     1                    | 3102668      | /home/lp/sglang/worker.py | 42100              |
+------------------------------------------------------------------------------------+
| No running processes found in NPU 1                                                   |
`;
const { npus: npus25 } = parseNpuSmi(ASCEND_25);
eq('25.5.1: count', npus25.length, 5);
eq('25.5.1: die 0 npuId', npus25[0] && npus25[0].npuId, '0');
eq('25.5.1: die 0 die', npus25[0] && npus25[0].die, '0');
eq('25.5.1: die 0 hbm', npus25[0] && npus25[0].hbmUsed, 46904);
eq('25.5.1: die 0 aicore', npus25[0] && npus25[0].util, 0);
eq('25.5.1: die 0 process dir', npus25[0] && npus25[0].processDir, '/home/rjw/sglang-k3');
eq('25.5.1: later die process dir', npus25[3] && npus25[3].processDir, '/home/lp/sglang');
eq('25.5.1: die 0 name', npus25[0] && npus25[0].name, 'Ascend910');
eq('25.5.1: die 4 hbm', npus25[4] && npus25[4].hbmUsed, 3120);
eq('25.5.1: no process table leak', !npus25.some(n => /Process/.test(n.name || '')), true);
eq('25.5.1: sort by npuId then die', npus25[2] && npus25[2].npuId + '/' + npus25[2].die, '1/0');
eq('25.5.1: memoryUsed uses hbm (not 0)', npus25[0] && npus25[0].memoryUsed, 46904);
eq('25.5.1: memoryTotal uses hbm (not 0)', npus25[0] && npus25[0].memoryTotal, 65536);

const ASCEND_25_6_SINGLE_DIE = `+------------------------------------------------------------------------------------------------------------------+
| npu-smi 25.6.rc1.b169                            Version: 25.6.rc1.b169                                          |
+--------+------------------+---------------+----------------------------------------------------------------------+
| NPU ID | Name             | Health        | Power(W)              Temp(C)                  Hugepages-Usage(page) |
|        |                  | Bus-Id        | NPU Util(%)           Memory-Usage(MB)         HBM-Usage(MB)         |
+========+==================+===============+======================================================================+
| 0      | Ascend950DT      | OK            | 380.7                 44                       0     / 0             |
|        |                  | NA            | 0                     0     / 0                6632  / 86016         |
+===========================+===============+======================================================================+
| 1      | Ascend950DT      | OK            | 380.3                 51                       0     / 0             |
|        |                  | NA            | 5                     0     / 0                6711  / 86016         |
+===========================+===============+======================================================================+
| 6      | Ascend950DT      | OK            | 381.1                 50                       0     / 0             |
|        |                  | NA            | 0                     0     / 0                66466 / 86016         |
+===========================+===============+======================================================================+
| 7      | Ascend950DT      | OK            | 379.5                 46                       0     / 0             |
|        |                  | NA            | 0                     0     / 0                66461 / 86016         |
+===========================+===============+======================================================================+
+---------------------------+---------------+----------------------------------------------------------------------+
| NPU ID                    | Process id    | Process name       | Process memory(MB)    | Process id in container |
+===========================+===============+======================================================================+
| 6                         | 3621066       | /home/lp/sglang/worker.py | 40000                 | NA                      |
| 6                         | 3624823       | /home/rjw/sglang-k3/worker.py | 61140                 | NA                      |
| 6                         | 3624824       | /home/rjw/sglang-k3/helper.py | 20000                 | NA                      |
+===========================+===============+======================================================================+`;
const { npus: npus256 } = parseNpuSmi(ASCEND_25_6_SINGLE_DIE);
eq('25.6 single-die: count', npus256.length, 4);
eq('25.6 single-die: npu 0 hbm', npus256[0] && npus256[0].hbmUsed, 6632);
eq('25.6 single-die: npu 1 util', npus256[1] && npus256[1].util, 5);
eq('25.6 single-die: npu 6 hbm', npus256[2] && npus256[2].hbmUsed, 66466);
eq('25.6 single-die: npu 6 process dir', npus256[2] && npus256[2].processDir, '/home/rjw/sglang-k3');
eq('25.6 single-die: no process table leak', !npus256.some(n => n.name === '3621066' || n.id === '3621066'), true);

if (failed === 0) {
  console.log('\n  ALL PARSER TESTS PASSED');
  process.exit(0);
} else {
  console.log('\n  ' + failed + ' test(s) failed');
  process.exit(1);
}
