#!/usr/bin/env python3
"""第三方在线音乐源的可达性探测（懒猫 LPK · 返工 #20657）。

为什么需要它
------------
驳回原文：「添加qq音乐之后播放失败」。MA 的 QQ 音乐/网易云音乐是「账号绑定 + 直连服务端」的
第三方音乐源：加源时只走 QQ 的扫码登录（ptlogin，可达），所以看着"加成功了"；但之后取库、取流
要访问 u.y.qq.com / isure.stream.qqmusic.qq.com 之类的域名。实测本机网络对这批域名是
「TCP 能连、TLS ClientHello 立刻被 RST」（同一个 IP 换 SNI 就能握手），即按域名阻断，
不是应用能修的。结果就是界面上只剩一句「执行动作失败」。

本脚本给 setup_script 用：探测某个 provider 需要的域名是否真的能 TLS 握手，
探测不过就让 setup_script 把该 provider 目录移出 venv —— 界面上不会出现这个音乐源，
评审也就点不到必然失败的按钮；网络恢复后重启应用会自动移回。

用法：
    python3 lzc-provider-gate.py <domain> <host1,host2,...>
退出码：0 = 全部可达；1 = 有不可达项（连接/握手失败）；2 = 参数错误。
"""
import socket
import ssl
import sys
import time

TIMEOUT = 5


def probe(host: str) -> tuple[bool, str]:
    t0 = time.time()
    try:
        sock = socket.create_connection((host, 443), timeout=TIMEOUT)
    except Exception as err:  # noqa: BLE001 - 任何网络异常都算不可达
        return False, "TCP_FAIL %s" % type(err).__name__
    try:
        ctx = ssl.create_default_context()
        tls = ctx.wrap_socket(sock, server_hostname=host)
        tls.close()
        return True, "TLS_OK %dms" % int((time.time() - t0) * 1000)
    except Exception as err:  # noqa: BLE001
        try:
            sock.close()
        except Exception:  # noqa: BLE001
            pass
        return False, "TLS_FAIL %s(%s)" % (type(err).__name__, getattr(err, "errno", ""))


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: lzc-provider-gate.py <domain> <host,host,...>", file=sys.stderr)
        return 2
    domain = sys.argv[1]
    hosts = [h.strip() for h in sys.argv[2].split(",") if h.strip()]
    results = []
    all_ok = True
    for host in hosts:
        ok, detail = probe(host)
        all_ok = all_ok and ok
        results.append("%s %s" % (host, detail))
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print("[%s] %s -> %s" % (stamp, domain, " | ".join(results)))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
