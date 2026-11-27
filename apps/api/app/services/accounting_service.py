import calendar
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import (
    AccountingConfig,
    AccountingPeriod,
    AccountType,
    ChartOfAccount,
    DepositStatus,
    EventExpense,
    FiscalYear,
    Invoice,
    InvoiceStatus,
    JournalEntry,
    JournalLine,
    NormalBalance,
    PaymentMilestone,
    PeriodStatus,
    SequenceCounter,
    default_normal_balance,
)
from app.models.base import RecordLifecycle, utcnow
from app.models.events import AuditLog, Event, EventStatus


class DoubleEntryService:
    @staticmethod
    async def next_sequence_number(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        doc_type: str,
        year: Optional[int] = None,
    ) -> str:
        y = year or utcnow().year
        clean_type = doc_type.strip().upper()
        counter = (
            await db.execute(
                select(SequenceCounter)
                .where(
                    SequenceCounter.tenant_id == tenant_id,
                    SequenceCounter.doc_type == clean_type,
                    SequenceCounter.year == y,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not counter:
            counter = SequenceCounter(tenant_id=tenant_id, doc_type=clean_type, year=y, last_number=0)
            db.add(counter)
            await db.flush()
        counter.last_number += 1
        await db.flush()
        return f"{clean_type}-{y}-{str(counter.last_number).zfill(6)}"

    @staticmethod
    async def ensure_fiscal_year_with_periods(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        year: int,
    ) -> FiscalYear:
        existing = (
            await db.execute(
                select(FiscalYear).where(
                    FiscalYear.tenant_id == tenant_id,
                    FiscalYear.year_label == str(year),
                )
            )
        ).scalar_one_or_none()
        if existing:
            return existing

        fy = FiscalYear(
            tenant_id=tenant_id,
            year_label=str(year),
            start_date=datetime(year, 1, 1, 0, 0, 0),
            end_date=datetime(year, 12, 31, 23, 59, 59),
            status=PeriodStatus.OPEN,
        )
        db.add(fy)
        await db.flush()
        for month in range(1, 13):
            last_day = calendar.monthrange(year, month)[1]
            db.add(
                AccountingPeriod(
                    tenant_id=tenant_id,
                    fiscal_year_id=fy.id,
                    period_number=month,
                    name=f"{year}-{str(month).zfill(2)}",
                    start_date=datetime(year, month, 1, 0, 0, 0),
                    end_date=datetime(year, month, last_day, 23, 59, 59),
                    status=PeriodStatus.OPEN,
                )
            )
        await db.flush()
        return fy

    @staticmethod
    async def _resolve_open_period(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        entry_date: datetime,
    ) -> AccountingPeriod:
        has_any_fy = (
            await db.execute(select(FiscalYear.id).where(FiscalYear.tenant_id == tenant_id).limit(1))
        ).scalar_one_or_none()
        if not has_any_fy:
            await DoubleEntryService.ensure_fiscal_year_with_periods(db, tenant_id, entry_date.year)

        row = (
            await db.execute(
                select(AccountingPeriod, FiscalYear)
                .join(FiscalYear, AccountingPeriod.fiscal_year_id == FiscalYear.id)
                .where(
                    AccountingPeriod.tenant_id == tenant_id,
                    AccountingPeriod.start_date <= entry_date,
                    AccountingPeriod.end_date >= entry_date,
                )
                .limit(1)
            )
        ).first()
        if not row:
            raise HTTPException(
                status_code=400,
                detail=f"No accounting period configured for date {entry_date.date().isoformat()}",
            )
        period, fy = row
        if fy.status != PeriodStatus.OPEN:
            raise HTTPException(
                status_code=400,
                detail=f"Fiscal year {fy.year_label} is {fy.status.value} and cannot accept postings",
            )
        if period.status != PeriodStatus.OPEN:
            raise HTTPException(
                status_code=400,
                detail=f"Accounting period {period.name} is {period.status.value} and locked against postings",
            )
        return period

    @staticmethod
    async def post_balanced_entry(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        created_by_id: uuid.UUID,
        reference: str,
        description: str,
        lines: list[dict],
        event_id: Optional[uuid.UUID] = None,
        entry_date: Optional[datetime] = None,
        is_system_posting: bool = False,
        idempotency_key: Optional[str] = None,
    ) -> JournalEntry:
        if idempotency_key:
            existing_je = (
                await db.execute(
                    select(JournalEntry).where(
                        JournalEntry.tenant_id == tenant_id,
                        JournalEntry.idempotency_key == idempotency_key,
                    )
                )
            ).scalar_one_or_none()
            if existing_je:
                return existing_je

        if not lines or len(lines) < 2:
            raise HTTPException(status_code=400, detail="Journal entry must contain at least 2 lines")

        parsed_lines: list[tuple[uuid.UUID, Decimal, Decimal, Optional[str]]] = []
        total_debit = Decimal("0.00")
        total_credit = Decimal("0.00")
        for l in lines:
            d = Decimal(str(l.get("debit", 0))).quantize(Decimal("0.01"))
            c = Decimal(str(l.get("credit", 0))).quantize(Decimal("0.01"))
            if d < Decimal("0.00") or c < Decimal("0.00"):
                raise HTTPException(status_code=400, detail="Debit and credit amounts must be non-negative")
            if d == Decimal("0.00") and c == Decimal("0.00"):
                raise HTTPException(status_code=400, detail="Zero-amount journal lines are not allowed")
            if d > Decimal("0.00") and c > Decimal("0.00"):
                raise HTTPException(status_code=400, detail="A single line cannot have both debit and credit > 0")
            acc_id = uuid.UUID(str(l["account_id"]))
            parsed_lines.append((acc_id, d, c, l.get("memo")))
            total_debit += d
            total_credit += c

        if abs(total_debit - total_credit) >= Decimal("0.01") or total_debit <= Decimal("0.00"):
            raise HTTPException(
                status_code=400,
                detail=f"Unbalanced journal entry: debit={total_debit}, credit={total_credit}",
            )

        account_ids = {acc_id for acc_id, _, _, _ in parsed_lines}
        found_accounts = (
            await db.execute(
                select(ChartOfAccount).where(
                    ChartOfAccount.tenant_id == tenant_id,
                    ChartOfAccount.id.in_(account_ids),
                    ChartOfAccount.lifecycle == RecordLifecycle.ACTIVE,
                )
            )
        ).scalars().all()
        if len(found_accounts) != len(account_ids):
            raise HTTPException(status_code=400, detail="One or more accounts do not belong to this active tenant COA")

        if not is_system_posting:
            blocked = [a.code for a in found_accounts if a.is_control_account]
            if blocked:
                raise HTTPException(
                    status_code=400,
                    detail=f"Direct manual posting to Control Account(s) {', '.join(sorted(blocked))} is prohibited",
                )

        eff_date = (entry_date.replace(tzinfo=None) if entry_date and entry_date.tzinfo else entry_date) or utcnow()
        period = await DoubleEntryService._resolve_open_period(db, tenant_id, eff_date)
        entry_number = await DoubleEntryService.next_sequence_number(db, tenant_id, "JE", eff_date.year)

        entry = JournalEntry(
            tenant_id=tenant_id,
            event_id=event_id,
            fiscal_period_id=period.id,
            entry_number=entry_number,
            entry_date=eff_date,
            reference=reference,
            description=description,
            is_system_posting=is_system_posting,
            idempotency_key=idempotency_key,
            status="POSTED",
            created_by_id=created_by_id,
        )
        db.add(entry)
        await db.flush()
        for acc_id, d, c, memo in parsed_lines:
            db.add(
                JournalLine(
                    tenant_id=tenant_id,
                    journal_entry_id=entry.id,
                    account_id=acc_id,
                    debit=d,
                    credit=c,
                    memo=memo,
                )
            )
        await db.flush()
        return entry

    @staticmethod
    async def post_invoice_accrual(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        created_by_id: uuid.UUID,
        invoice: Invoice,
        hall_and_addons_net: Decimal,
        catering_net: Decimal,
        event_code: str,
    ) -> Optional[JournalEntry]:
        if Decimal(str(invoice.total_amount)) <= Decimal("0.00"):
            return None
        cfg = (
            await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not cfg or not cfg.accounts_receivable_id or not cfg.hall_revenue_account_id:
            raise HTTPException(status_code=400, detail="AccountingConfig accounts incomplete for invoice accrual")

        total_amt = Decimal(str(invoice.total_amount)).quantize(Decimal("0.01"))
        tax_amt = Decimal(str(invoice.tax_amount)).quantize(Decimal("0.01"))
        cat_amt = Decimal(str(catering_net)).quantize(Decimal("0.01"))
        hall_amt = (total_amt - tax_amt - cat_amt).quantize(Decimal("0.01"))
        if hall_amt < Decimal("0.00"):
            cat_amt = max(Decimal("0.00"), total_amt - tax_amt)
            hall_amt = Decimal("0.00")

        lines: list[dict] = [
            {
                "account_id": cfg.accounts_receivable_id,
                "debit": total_amt,
                "credit": Decimal("0.00"),
                "memo": f"AR {invoice.invoice_number}",
            }
        ]
        if hall_amt > Decimal("0.00"):
            lines.append(
                {
                    "account_id": cfg.hall_revenue_account_id,
                    "debit": Decimal("0.00"),
                    "credit": hall_amt,
                    "memo": f"Hall & Addons Revenue {event_code}",
                }
            )
        if cat_amt > Decimal("0.00"):
            cat_acc = cfg.catering_revenue_account_id or cfg.hall_revenue_account_id
            lines.append(
                {
                    "account_id": cat_acc,
                    "debit": Decimal("0.00"),
                    "credit": cat_amt,
                    "memo": f"Catering Revenue {event_code}",
                }
            )
        if tax_amt > Decimal("0.00"):
            if not cfg.tax_payable_account_id:
                raise HTTPException(status_code=400, detail="Tax payable account missing in AccountingConfig")
            lines.append(
                {
                    "account_id": cfg.tax_payable_account_id,
                    "debit": Decimal("0.00"),
                    "credit": tax_amt,
                    "memo": f"VAT / Sales Tax {invoice.invoice_number}",
                }
            )

        return await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=created_by_id,
            reference=invoice.invoice_number,
            description=f"Invoice accrual for {event_code} ({invoice.invoice_number})",
            event_id=invoice.event_id,
            lines=lines,
            is_system_posting=True,
            idempotency_key=f"INV_ACCRUAL:{invoice.id}",
        )

    @staticmethod
    async def reverse_entry(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        entry_id: uuid.UUID,
        reason: Optional[str] = None,
    ) -> dict:
        entry = (
            await db.execute(
                select(JournalEntry)
                .where(JournalEntry.id == entry_id, JournalEntry.tenant_id == tenant_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="Journal entry not found")
        if entry.status == "REVERSED" or entry.reversed_entry_id is not None:
            raise HTTPException(status_code=409, detail="Journal entry has already been reversed or is a reversal")

        orig_lines = (
            await db.execute(
                select(JournalLine).where(
                    JournalLine.journal_entry_id == entry.id,
                    JournalLine.tenant_id == tenant_id,
                )
            )
        ).scalars().all()
        if not orig_lines:
            raise HTTPException(status_code=400, detail="Cannot reverse journal entry with no lines")

        rev_lines = [
            {
                "account_id": l.account_id,
                "debit": Decimal(str(l.credit)),
                "credit": Decimal(str(l.debit)),
                "memo": f"Reversal of {entry.entry_number}" + (f": {l.memo}" if l.memo else ""),
            }
            for l in orig_lines
        ]
        rev_desc = f"Reversal of {entry.entry_number}" + (f" — {reason}" if reason else "")
        rev_entry = await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=user_id,
            reference=f"REV-{entry.entry_number}",
            description=rev_desc,
            lines=rev_lines,
            event_id=entry.event_id,
            is_system_posting=True,
            idempotency_key=f"REV:{entry.id}",
        )
        rev_entry.reversed_entry_id = entry.id
        entry.status = "REVERSED"
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=entry.event_id,
                actor_id=user_id,
                action="JOURNAL_ENTRY_REVERSED",
                old_value={"entry_number": entry.entry_number, "status": "POSTED"},
                new_value={
                    "original_entry_id": str(entry.id),
                    "reversal_entry_id": str(rev_entry.id),
                    "reversal_entry_number": rev_entry.entry_number,
                    "reason": reason,
                },
            )
        )
        await db.commit()
        return {
            "status": "REVERSED",
            "original_entry_id": str(entry.id),
            "reversal_entry_id": str(rev_entry.id),
            "reversal_entry_number": rev_entry.entry_number,
        }

    @staticmethod
    async def verify_milestone_payment(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        milestone_id: uuid.UUID,
        payment_method: str,
        is_security_deposit: bool = False,
        reference: str = "Verified Transfer",
    ) -> dict:
        milestone = (
            await db.execute(
                select(PaymentMilestone)
                .where(
                    PaymentMilestone.id == milestone_id,
                    PaymentMilestone.tenant_id == tenant_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not milestone:
            raise HTTPException(status_code=404, detail="Payment milestone not found")
        if milestone.status == "PAID":
            raise HTTPException(status_code=409, detail="Payment milestone has already been verified and paid")

        invoice = (
            await db.execute(
                select(Invoice)
                .where(Invoice.id == milestone.invoice_id, Invoice.tenant_id == tenant_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found in tenant")
        if invoice.status == InvoiceStatus.VOIDED:
            raise HTTPException(status_code=409, detail="Cannot verify payment on a voided invoice")

        cfg = (
            await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not cfg:
            raise HTTPException(status_code=400, detail="AccountingConfig missing for tenant")

        effective_deposit = bool(is_security_deposit or milestone.is_security_deposit)
        amount = Decimal(str(milestone.amount_due)).quantize(Decimal("0.01"))
        debit_acc = cfg.cash_account_id if payment_method.upper() == "CASH" else cfg.bank_account_id
        credit_acc = cfg.security_deposit_liab_id if effective_deposit else cfg.accounts_receivable_id
        if not debit_acc or not credit_acc:
            raise HTTPException(status_code=400, detail="AccountingConfig accounts incomplete for tenant")

        entry = await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=user_id,
            reference=f"PAY-{invoice.invoice_number} — {reference}",
            description=f"Verified payment ({payment_method}) for {milestone.title}",
            event_id=invoice.event_id,
            lines=[
                {"account_id": debit_acc, "debit": amount, "credit": Decimal("0.00"), "memo": milestone.title},
                {"account_id": credit_acc, "debit": Decimal("0.00"), "credit": amount, "memo": milestone.title},
            ],
            is_system_posting=True,
            idempotency_key=f"PAY_MS:{milestone.id}",
        )

        milestone.paid_amount = amount
        milestone.payment_method = payment_method
        milestone.status = "PAID"
        milestone.paid_at = utcnow()
        milestone.upload_token_jti = None

        if effective_deposit:
            invoice.deposit_status = DepositStatus.HELD
        else:
            all_milestones = (
                await db.execute(
                    select(PaymentMilestone).where(
                        PaymentMilestone.invoice_id == invoice.id,
                        PaymentMilestone.tenant_id == tenant_id,
                    )
                )
            ).scalars().all()
            total_paid = sum(
                (Decimal(str(m.paid_amount)) for m in all_milestones if not m.is_security_deposit),
                Decimal("0.00"),
            )
            if total_paid >= Decimal(str(invoice.total_amount)):
                invoice.status = InvoiceStatus.PAID
            elif total_paid > Decimal("0.00"):
                invoice.status = InvoiceStatus.PARTIALLY_PAID

            ev = (
                await db.execute(
                    select(Event).where(Event.id == invoice.event_id, Event.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            if ev and ev.status == EventStatus.HOLD_48H:
                ev.status = EventStatus.CONFIRMED

        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=invoice.event_id,
                actor_id=user_id,
                action="PAYMENT_VERIFIED",
                new_value={
                    "milestone_id": str(milestone.id),
                    "amount": float(amount),
                    "is_security_deposit": effective_deposit,
                    "payment_method": payment_method,
                    "journal_entry_id": str(entry.id),
                    "journal_entry_number": entry.entry_number,
                },
            )
        )
        await db.commit()
        return {
            "status": "VERIFIED",
            "invoice_status": invoice.status.value,
            "journal_entry_id": str(entry.id),
            "journal_entry_number": entry.entry_number,
        }

    @staticmethod
    async def get_trial_balance(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> dict:
        accounts = (
            await db.execute(
                select(ChartOfAccount)
                .where(ChartOfAccount.tenant_id == tenant_id)
                .order_by(ChartOfAccount.code.asc())
            )
        ).scalars().all()

        agg_q = (
            select(
                JournalLine.account_id,
                func.coalesce(func.sum(JournalLine.debit), 0),
                func.coalesce(func.sum(JournalLine.credit), 0),
            )
            .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
            .where(
                JournalLine.tenant_id == tenant_id,
                JournalEntry.tenant_id == tenant_id,
                JournalEntry.status.in_(["POSTED", "REVERSED"]),
            )
        )
        if from_date:
            agg_q = agg_q.where(JournalEntry.entry_date >= from_date.replace(tzinfo=None))
        if to_date:
            agg_q = agg_q.where(JournalEntry.entry_date <= to_date.replace(tzinfo=None))

        agg_rows = (await db.execute(agg_q.group_by(JournalLine.account_id))).all()
        totals_by_acc = {row[0]: (Decimal(str(row[1])), Decimal(str(row[2]))) for row in agg_rows}

        rows = []
        grand_debit = Decimal("0.00")
        grand_credit = Decimal("0.00")
        for acc in accounts:
            d, c = totals_by_acc.get(acc.id, (Decimal("0.00"), Decimal("0.00")))
            grand_debit += d
            grand_credit += c
            norm = acc.normal_balance or default_normal_balance(acc.account_type)
            signed_balance = (d - c) if norm == NormalBalance.DEBIT else (c - d)
            rows.append(
                {
                    "account_id": str(acc.id),
                    "code": acc.code,
                    "name_ar": acc.name_ar,
                    "name_en": acc.name_en,
                    "account_type": acc.account_type.value,
                    "normal_balance": norm.value,
                    "is_control_account": acc.is_control_account,
                    "total_debit": float(d),
                    "total_credit": float(c),
                    "balance": float(signed_balance),
                }
            )
        return {
            "rows": rows,
            "total_debit": float(grand_debit),
            "total_credit": float(grand_credit),
            "is_balanced": grand_debit.quantize(Decimal("0.01")) == grand_credit.quantize(Decimal("0.01")),
        }

    @staticmethod
    async def get_account_ledger(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        account_id: uuid.UUID,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> dict:
        acc = (
            await db.execute(
                select(ChartOfAccount).where(
                    ChartOfAccount.id == account_id,
                    ChartOfAccount.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if not acc:
            raise HTTPException(status_code=404, detail="Account not found")

        norm = acc.normal_balance or default_normal_balance(acc.account_type)

        opening_balance = Decimal("0.00")
        if from_date:
            naive_from = from_date.replace(tzinfo=None)
            open_row = (
                await db.execute(
                    select(
                        func.coalesce(func.sum(JournalLine.debit), 0),
                        func.coalesce(func.sum(JournalLine.credit), 0),
                    )
                    .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
                    .where(
                        JournalLine.tenant_id == tenant_id,
                        JournalLine.account_id == acc.id,
                        JournalEntry.status.in_(["POSTED", "REVERSED"]),
                        JournalEntry.entry_date < naive_from,
                    )
                )
            ).one()
            od, oc = Decimal(str(open_row[0])), Decimal(str(open_row[1]))
            opening_balance = (od - oc) if norm == NormalBalance.DEBIT else (oc - od)

        q = (
            select(JournalLine, JournalEntry)
            .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
            .where(
                JournalLine.tenant_id == tenant_id,
                JournalLine.account_id == acc.id,
                JournalEntry.status.in_(["POSTED", "REVERSED"]),
            )
            .order_by(JournalEntry.entry_date.asc(), JournalEntry.created_at.asc())
        )
        if from_date:
            q = q.where(JournalEntry.entry_date >= from_date.replace(tzinfo=None))
        if to_date:
            q = q.where(JournalEntry.entry_date <= to_date.replace(tzinfo=None))

        lines = (await db.execute(q)).all()
        running = opening_balance
        txs = []
        for line, je in lines:
            d = Decimal(str(line.debit))
            c = Decimal(str(line.credit))
            running += (d - c) if norm == NormalBalance.DEBIT else (c - d)
            txs.append(
                {
                    "journal_entry_id": str(je.id),
                    "entry_number": je.entry_number,
                    "entry_date": je.entry_date.isoformat(),
                    "reference": je.reference,
                    "description": je.description,
                    "memo": line.memo,
                    "status": je.status,
                    "event_id": str(je.event_id) if je.event_id else None,
                    "debit": float(d),
                    "credit": float(c),
                    "running_balance": float(running),
                }
            )

        return {
            "account": {
                "id": str(acc.id),
                "code": acc.code,
                "name_ar": acc.name_ar,
                "name_en": acc.name_en,
                "account_type": acc.account_type.value,
                "normal_balance": norm.value,
            },
            "opening_balance": float(opening_balance),
            "closing_balance": float(running),
            "transactions": txs,
        }

    @staticmethod
    async def get_financial_statements(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> dict:
        tb_all = await DoubleEntryService.get_trial_balance(db, tenant_id, None, to_date)
        tb_period = await DoubleEntryService.get_trial_balance(db, tenant_id, from_date, to_date)

        assets = [r for r in tb_all["rows"] if r["account_type"] == AccountType.ASSET.value]
        liabilities = [r for r in tb_all["rows"] if r["account_type"] == AccountType.LIABILITY.value]
        equity = [r for r in tb_all["rows"] if r["account_type"] == AccountType.EQUITY.value]

        revenues = [r for r in tb_period["rows"] if r["account_type"] == AccountType.REVENUE.value]
        expenses = [r for r in tb_period["rows"] if r["account_type"] == AccountType.EXPENSE.value]

        total_rev = sum((Decimal(str(r["balance"])) for r in revenues), Decimal("0.00"))
        total_exp = sum((Decimal(str(r["balance"])) for r in expenses), Decimal("0.00"))
        net_income = total_rev - total_exp

        # Cumulative net income for Balance Sheet balancing as of to_date
        cum_rev = sum(
            (Decimal(str(r["balance"])) for r in tb_all["rows"] if r["account_type"] == AccountType.REVENUE.value),
            Decimal("0.00"),
        )
        cum_exp = sum(
            (Decimal(str(r["balance"])) for r in tb_all["rows"] if r["account_type"] == AccountType.EXPENSE.value),
            Decimal("0.00"),
        )
        cum_net_income = cum_rev - cum_exp

        total_assets = sum((Decimal(str(r["balance"])) for r in assets), Decimal("0.00"))
        total_liabilities = sum((Decimal(str(r["balance"])) for r in liabilities), Decimal("0.00"))
        total_equity_accounts = sum((Decimal(str(r["balance"])) for r in equity), Decimal("0.00"))
        total_equity_and_earnings = total_equity_accounts + cum_net_income

        return {
            "income_statement": {
                "revenues": revenues,
                "expenses": expenses,
                "total_revenue": float(total_rev),
                "total_expenses": float(total_exp),
                "net_income": float(net_income),
            },
            "balance_sheet": {
                "assets": assets,
                "liabilities": liabilities,
                "equity": equity,
                "current_net_income": float(cum_net_income),
                "total_assets": float(total_assets),
                "total_liabilities": float(total_liabilities),
                "total_equity": float(total_equity_and_earnings),
                "total_liabilities_and_equity": float(total_liabilities + total_equity_and_earnings),
                "is_balanced": abs(total_assets - (total_liabilities + total_equity_and_earnings)) < Decimal("0.01"),
            },
        }

    @staticmethod
    async def get_event_pnl(db: AsyncSession, tenant_id: uuid.UUID, event_id: uuid.UUID) -> dict:
        event = (
            await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        invoices = (
            await db.execute(
                select(Invoice).where(
                    Invoice.event_id == event_id,
                    Invoice.tenant_id == tenant_id,
                    Invoice.status != InvoiceStatus.VOIDED,
                )
            )
        ).scalars().all()
        net_rev = sum((Decimal(str(i.subtotal)) for i in invoices), Decimal("0.00"))
        discounts = sum((Decimal(str(i.discount_amount)) for i in invoices), Decimal("0.00"))
        gross = net_rev + discounts
        deposit_held = sum(
            (
                Decimal(str(i.security_deposit_amount))
                for i in invoices
                if i.deposit_status == DepositStatus.HELD
            ),
            Decimal("0.00"),
        )

        expenses = (
            await db.execute(
                select(EventExpense)
                .where(EventExpense.event_id == event_id, EventExpense.tenant_id == tenant_id)
                .order_by(EventExpense.created_at.desc())
            )
        ).scalars().all()
        total_exp = sum((Decimal(str(e.amount)) for e in expenses), Decimal("0.00"))
        catering_cogs = sum(
            (Decimal(str(e.amount)) for e in expenses if e.category.upper() in {"CATERING", "CATERING_COGS"}),
            Decimal("0.00"),
        )
        profit = net_rev - total_exp

        return {
            "event_id": str(event.id),
            "event_code": event.event_code,
            "gross_revenue": float(gross),
            "discounts": float(discounts),
            "net_revenue": float(net_rev),
            "catering_cogs": float(catering_cogs),
            "expenses": [
                {
                    "id": str(e.id),
                    "category": e.category,
                    "description": e.description,
                    "amount": float(e.amount),
                    "payment_method": e.payment_method,
                    "account_id": str(e.account_id) if e.account_id else None,
                    "journal_entry_id": str(e.journal_entry_id) if e.journal_entry_id else None,
                    "created_at": e.created_at.isoformat(),
                }
                for e in expenses
            ],
            "total_expenses": float(total_exp),
            "net_profit": float(profit),
            "margin_percent": float((profit / net_rev * 100).quantize(Decimal("0.01"))) if net_rev > 0 else 0.0,
            "security_deposit_held": float(deposit_held),
        }
