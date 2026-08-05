/* 新增扫描规则功能性测试：验证正则匹配 + toString 往返 */
const PATTERNS = {
    PRIVATE_KEY: /-----\s*BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+|PGP\s+|ENCRYPTED\s+)?PRIVATE KEY\s*-----[\s\S]{32,}?-----\s*END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+|PGP\s+|ENCRYPTED\s+)?PRIVATE KEY\s*-----/g,
    DB_CONN: /(?:mongodb(?:\+srv)?:\/\/|mysql:\/\/|postgres(?:ql)?:\/\/|redis:\/\/|mssql:\/\/|jdbc:[a-zA-Z]+:\/\/)[^\s"'<>]{6,}/gi,
    MQ_CONN: /amqp:\/\/[^\s"'<>]{6,}|kafka:\/\/[^\s"'<>]{6,}/gi,
    LINUX_PATH: /(?:^|["'(=\s])(\/(?:etc|var|usr|root|home|opt|tmp|proc|sys)\/[^\s"'<>)\]}{]{3,})/g,
    SOURCE_MAP: /\/\/[#@]\s*sourceMappingURL=[^\s'"]+/g,
    OSS_ENDPOINT: /https?:\/\/[a-z0-9-]+\.(?:oss|cos|s3|obs|bcebos|myqcloud|amazonaws)[a-z0-9.-]*\.[a-z0-9.-]+[^\s"'<>)\]}{]*/gi,
    ID_KEY: [
        { name: '微信小程序', pattern: /["'(]wx[0-9a-f]{16,18}["')]/g },
        { name: 'AWS', pattern: /(?:AKIA|ASIA|AIDA|AGPA|AROA|AIPA|ANPA|ANVA|A3T)[0-9A-Z]{16}/g },
        { name: 'Stripe', pattern: /(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}/g },
        { name: 'Twilio', pattern: /SK[0-9a-fA-F]{32}/g },
        { name: '钉钉', pattern: /ding[a-z0-9]{15,}/g },
        { name: '飞书', pattern: /cli_[a-z0-9]{16}/g }
    ]
};

const samples = {
    PRIVATE_KEY: `config = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz\n-----END RSA PRIVATE KEY-----"`,
    DB_CONN: `url: "mongodb://admin:s3cr3t@10.0.0.1:27017/db" and redis://r:6379/0`,
    MQ_CONN: `conn = "amqp://guest:guest@rabbitmq:5672//"`,
    LINUX_PATH: `path = "/etc/passwd" and "/var/log/nginx/access.log"`,
    SOURCE_MAP: `bundle.js\n//# sourceMappingURL=bundle.js.map`,
    OSS_ENDPOINT: `endpoint: "https://mybucket.oss-cn-hangzhou.aliyuncs.com/file"`,
    '微信小程序': `appId = "wx1234567890abcdef"`,
    'AWS': `accessKey = "AKIAIOSFODNN7EXAMPLE"`,
    'Stripe': `key = "sk_live_51HqkxXabcdefghijklmnopqrstuvwxyz"`,
    'Twilio': `token = "SK1234567890abcdef1234567890abcdef"`,
    '钉钉': `token: dingabcdef1234567890`,
    '飞书': `appId: cli_abcdef0123456789`
};

function roundtrip(re) {
    const s = re.toString();
    const m = s.match(/^\/(.+)\/([gimuy]*)$/);
    if (!m) return null;
    return new RegExp(m[1], m[2]);
}

let pass = 0, fail = 0;
for (const [name, sample] of Object.entries(samples)) {
    let pat;
    if (name === '微信小程序' || name === 'AWS' || name === 'Stripe' || name === 'Twilio' || name === '钉钉' || name === '飞书') {
        pat = PATTERNS.ID_KEY.find(p => p.name === name).pattern;
    } else {
        pat = PATTERNS[name];
    }
    const re = roundtrip(pat);
    const matches = sample.match(re);
    if (matches && matches.length > 0) {
        console.log(`  ✓ ${name}: 匹配 ${matches.length} 个 → ${matches[0].slice(0, 60)}...`);
        pass++;
    } else {
        console.log(`  ✗ ${name}: 未匹配！样本: ${sample.slice(0, 60)}`);
        fail++;
    }
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
