#!/usr/bin/env python3
"""懒猫微服 · Music Assistant 音乐自动入库助手（常驻后台）。

为什么需要它
------------
MA 内置的文件系统音乐源默认「每 3 小时」才同步一次音乐库（`TaskSchedule.hourly(every=3)`，
见镜像内 `providers/builtin/__init__.py`）。用户把音乐放进「应用文稿 / 微服网盘」后，
如果不在 MA 界面里手动触发同步，就要等最多 3 小时才会出现在「歌曲」里，
看起来就是「添加了歌曲文件夹，音乐里面看不到」（评审驳回 #20394）。

本脚本常驻在应用容器里，定期调用 MA 的 JSON-RPC API 触发 `music/sync`，
让新放进来的音乐在几分钟内自动入库，用户不需要任何手动操作。

凭据与包内免密注入一致（admin + 包内固定口令，同 inject params）。
首次运行时如果服务器还没有任何用户，先用 `POST /setup` 建号，
与浏览器注入的首次初始化互为兜底（谁先到谁生效，另一个会收到「已初始化」）。

环境变量：
  MA_BASE_URL           默认 http://127.0.0.1:8095
  LZC_MA_USER           默认 admin
  LZC_MA_PASS           必填（由 manifest 传入）
  LZC_MA_SYNC_INTERVAL  同步间隔秒数，默认 300（5 分钟）
  LZC_MA_WAIT_MAX       等待服务就绪的最长秒数，默认 900
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("MA_BASE_URL", "http://127.0.0.1:8095")
USER = os.environ.get("LZC_MA_USER", "admin")
PASS = os.environ.get("LZC_MA_PASS", "")
INTERVAL = max(60, int(os.environ.get("LZC_MA_SYNC_INTERVAL", "300")))
WAIT_MAX = int(os.environ.get("LZC_MA_WAIT_MAX", "900"))
MEDIA_TYPES = ["track", "album", "artist"]
DEVICE = "lzc-sync-agent"


def log(msg):
    print("[lzc-sync] %s %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg), flush=True)


def http(method, path, payload=None, token=None, timeout=90):
    """返回 (status, body)；连接层错误返回 status=0。"""
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace")
    except Exception as err:  # 连接被拒、超时等
        return 0, str(err)


def api(command, args=None, token=None, mid=1):
    return http(
        "POST",
        "/api",
        {"message_id": mid, "command": command, "args": args or {}},
        token=token,
    )


def wait_ready():
    """等 MA 的 http 服务起来（容器刚启动时端口还没监听）。"""
    deadline = time.time() + WAIT_MAX
    while time.time() < deadline:
        status, _ = http("GET", "/info", timeout=15)
        if status == 200:
            log("MA 服务已就绪（/info 200）")
            return True
        time.sleep(5)
    log("等待 MA 就绪超时（%ds），继续尝试" % WAIT_MAX)
    return False


def token_from(body):
    try:
        data = json.loads(body)
    except Exception:
        return ""
    if isinstance(data, dict):
        if isinstance(data.get("access_token"), str):
            return data["access_token"]
        if isinstance(data.get("token"), str):
            return data["token"]
        result = data.get("result")
        if isinstance(result, dict):
            for key in ("access_token", "token"):
                if isinstance(result.get(key), str):
                    return result[key]
    return ""


def get_token():
    """先登录；服务器还没有任何用户时先完成 /setup。返回 token 或空串。"""
    status, body = api("auth/login", {"username": USER, "password": PASS, "device_name": DEVICE})
    token = token_from(body)
    if token:
        return token
    log("登录未成功（HTTP %s），尝试首次初始化" % status)
    status, body = http("POST", "/setup", {"username": USER, "password": PASS, "device_name": DEVICE})
    token = token_from(body)
    if token:
        log("已完成首次初始化（/setup）")
        return token
    log("初始化也未成功（HTTP %s）：%s" % (status, body[:120]))
    return ""


def sync_once(token):
    status, body = api("music/sync", {"media_types": MEDIA_TYPES}, token=token, mid=2)
    if status == 200:
        count = body.count("music_sync_")
        log("已触发音乐库同步（任务数 %d）" % count)
        return True
    log("触发同步失败（HTTP %s）：%s" % (status, body[:120]))
    return False


def main():
    if not PASS:
        log("缺少 LZC_MA_PASS，退出")
        return 1
    log("自动入库助手启动：间隔 %ds，服务 %s" % (INTERVAL, BASE))
    wait_ready()
    token = ""
    while True:
        try:
            if not token:
                token = get_token()
            if token and not sync_once(token):
                token = ""  # token 失效就下一轮重新登录
            elif not token:
                log("暂无可用登录态，%ds 后重试" % INTERVAL)
        except Exception as err:  # 任何异常都不让守护进程退出
            log("本轮异常：%s" % err)
            token = ""
        time.sleep(INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
