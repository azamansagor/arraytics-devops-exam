# Session `d44420a4-7ab2-4b44-9721-ed7482fa007a`

Source: `d44420a4-7ab2-4b44-9721-ed7482fa007a.jsonl` — 26 events

---

## 👤 User  
<sub>2026-09-05T06:07:36.572Z</sub>

<ide_opened_file>The user opened the file c:\Users\AZAMA\OneDrive\Desktop\DevOps Exam\exam.md in the IDE. This may or may not be related to the current task.</ide_opened_file> @exam.md  file contains the question for our devops exam. Guide me through each porton of Scenarios like A1, A2, B1, B2 etc step by step. first take a section for exam, tell me what to do and after final confirmation of mine that I've submitted the report, move to next scenario or step.

---

## 👤 User  
<sub>2026-09-05T06:07:44.976Z</sub>

[Request interrupted by user]

---

## 👤 User  
<sub>2026-09-05T06:08:22.789Z</sub>

<ide_opened_file>The user opened the file c:\Users\AZAMA\OneDrive\Desktop\DevOps Exam\exam.md in the IDE. This may or may not be related to the current task.</ide_opened_file> file contains the question for our devops exam. Guide me through each porton of Scenarios like A1, A2, B1, B2 etc step by step. first take a section for exam, tell me what to do and after final confirmation of mine that I've submitted the report, move to next scenario or step. everything in bangla

## 🤖 Claude  
<sub>2026-09-05T06:09:03.722Z</sub>

আমি প্রথমে exam.md ফাইলটা পড়ে নিয়েছি (উপরে পুরোটা দেখা হয়েছে)। এখন আপনাকে ধাপে ধাপে গাইড করব — বাংলায়।

---

# 🔥 শুরুর আগে — কিছু জরুরি কথা

**আপনার এক্সাম কাঠামো:**
- মোট ৩০০ নম্বর + ১০ বোনাস
- পাস মার্ক ১৫০, এবং **প্রতিটি সিনারিওতে কমপক্ষে ৩০%** পেতে হবে
- Scenario A = ৮২, Scenario B = ১২৪, Scenario C = ৯৪

**ইনস্ট্যান্ট জিরো রুলস (ভুলেও করবেন না):**
- `chmod 777` — কোথাও না
- কন্টেইনারে `--privileged` — না
- রিপোতে AWS key, password, `.env` কমিট — না
- Security group-এ port 22 `0.0.0.0/0` — না
- সব একসাথে একটা কমিটে — **মাইনাস ২০**। কমপক্ষে ১৫টা কমিট লাগবে

---

## 🚦 STEP 0 — সেটআপ (এক্সাম শুরুর আগেই করতে হবে)

এটা কোনো টাস্ক না, কিন্তু এটা না করলে **সব স্ক্রিনশট জিরো**। তাই এটাই প্রথম ধাপ।

### আপনার যা লাগবে
| জিনিস | কেন |
|---|---|
| একটা VPS (Ubuntu 22.04/24.04) | Scenario A + B এর জন্য |
| একটা GitHub রিপো | সাবমিশন |
| একটা AWS Free Tier অ্যাকাউন্ট | Scenario C |
| একটা ডোমেইন (`.xyz` সস্তা, বা DuckDNS/nip.io ফ্রি) | Scenario C4 |

### ০.১ — সার্ভারে লগইন করে টোকেন বানান

```bash
export EXAM_TOKEN="$(whoami)-$(hostname)-$(date +%s)-$(head -c4 /dev/urandom | xxd -p)"
echo "$EXAM_TOKEN" | tee ~/exam_token.txt
echo "export EXAM_TOKEN=\"$EXAM_TOKEN\"" >> ~/.bashrc
```

এটা একবারই চালাবেন। এরপর টোকেনটা কপি করে রাখুন — README.md আর Grafana ড্যাশবোর্ডের নামে লাগবে।

**⚠️ গুরুত্বপূর্ণ:** প্রতিটা স্ক্রিনশট নেওয়ার আগে ঐ টার্মিনালে চালাবেন:
```bash
echo "$EXAM_TOKEN | $(date)"
```
তারপর আসল কমান্ড চালিয়ে **পুরো টার্মিনাল উইন্ডোর** স্ক্রিনশট নেবেন।

### ০.২ — রিপো স্ট্রাকচার বানান

লোকাল মেশিনে বা সার্ভারে:

```bash
mkdir -p devops-exam/{scenario-a/{configs,evidence},scenario-b/{app,docker,grafana,evidence},scenario-c/evidence}
cd devops-exam
git init
touch README.md AI_PROMPTS.md TIMELINE.md INCOMPLETE.md
touch scenario-a/ANSWERS.md scenario-b/ANSWERS.md scenario-c/ANSWERS.md
```

### ০.৩ — README.md-এ যা লিখবেন

```markdown
# DevOps Practical Exam

**Name:** <আপনার নাম>
**Exam Token:** `<আপনার টোকেন>`
**Server IP:** <VPS IP>
**Hosted links:** <Grafana URL, ALB URL, ডোমেইন ইত্যাদি — পরে ভরবেন>
```

### ০.৪ — .gitignore বানান (জিরো এড়ানোর জন্য)

```bash
cat > .gitignore <<'EOF'
.env
*.env
*.pem
*.key
node_modules/
credentials
.aws/
EOF
```

### ০.৫ — প্রথম কমিট

```bash
git add .
git commit -m "chore: repo skeleton, exam token in README"
```

---

## 📝 তিনটা অভ্যাস — পুরো এক্সাম জুড়ে চালিয়ে যাবেন

এগুলো আলাদা কোনো টাস্ক না, কিন্তু **নম্বর বহন করে**:

1. **`AI_PROMPTS.md`** — যখনই আমার (বা ChatGPT-র) সাহায্য নেবেন এবং সেটা কাজে লাগবে, একটা এন্ট্রি লিখবেন। ফরম্যাট: *কীসে আটকেছিলেন → ঠিক কী prompt দিয়েছিলেন → উত্তর কাজ করেছিল কি না → আপনার মেশিনে চালাতে কী বদলাতে হয়েছিল*। **কমপক্ষে ৮টা এন্ট্রি** লাগবে ১০ নম্বরের জন্য। শুধু prompt পেস্ট করলে ২ নম্বর।
2. **`TIMELINE.md`** — কাজের ডায়েরি। প্রতি সেশনে ২-৩ লাইন: কখন কী করলেন, কোথায় আটকালেন।
3. **কমিট** — প্রতিটা টাস্ক শেষে একটা কমিট। ১৫+ কমিট লাগবেই।

আর `INCOMPLETE.md` — যা শেষ করতে পারবেন না, সেটা **সৎভাবে লিখে দেবেন**। ডায়াগনোজ করে ব্যর্থ হলে ৬০% পর্যন্ত নম্বর, চুপচাপ স্কিপ করলে ০।

---

## ✅ এখন আপনার কাজ

উপরের **STEP 0** পুরোটা করুন:
- [ ] VPS-এ টোকেন জেনারেট
- [ ] GitHub রিপো + ফোল্ডার স্ট্রাকচার
- [ ] README.md-এ নাম, টোকেন, IP
- [ ] .gitignore
- [ ] প্রথম কমিট + GitHub-এ push

---

আপনি যখন বলবেন **"Step 0 done"** — আমি তখন **Scenario A → A1 (Task 1-4, ২০ নম্বর)** এর পুরো ধাপে ধাপে গাইড দেব: ইউজার/গ্রুপ তৈরি, ACL দিয়ে dan-এর সমস্যা, sticky bit দিয়ে carol-এর সমস্যা, আর sudoers দিয়ে alice/bob-এর restart পারমিশন — সাথে ১২টা প্রুফ চেকের কমান্ড।

শুরু করার আগে একটা প্রশ্ন: **আপনার VPS কি রেডি আছে, নাকি সেটাও সেটআপ করতে হবে?**
