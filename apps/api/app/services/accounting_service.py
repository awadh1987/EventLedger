import uuid
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import (
    AccountingConfig,
    ChartOfAccount,
    DepositStatus,
    EventExpense,
    Invoice,
    InvoiceStatus,
    JournalEntry,
    JournalLine,
    PaymentMilestone,
)
from app.models.base import utcnow
from app.models.events import AuditLog, Event


class DoubleEntryService:
    @staticmethod
    async def post_balanced_entry(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        created_by_id: uuid.UUID,
        reference: str,
        description: str,
        lines: list[dict],
        event_id: Optional[uuid.UUID] = None,
    ) -> JournalEntry:
        total_debit = sum((Decimal(str(l.get("debit", 0))) for l in lines), Decimal("0.00"))
        total_credit = sum((Decimal(str(l.get("credit", 0))) for l in lines), Decimal("0.00"))
        if abs(total_debit - total_credit) >= Decimal("0.01") or total_debit <= Decimal("0.00"):
            raise HTTPException(
                status_code=400,
                detail=f"Unbalanced journal entry: debit={total_debit}, credit={total_credit}",
            )

        # Verify all accounts belong to this tenant
        account_ids = {uuid.UUID(str(l["account_id"])) for l in lines}
        found_accounts = (
            await db.execute(
                select(ChartOfAccount.id).where(
                    ChartOfAccount.tenant_id == tenant_id,
                    ChartOfAccount.id.in_(account_ids),
                )
            )
        ).scalars().all()
        if len(set(found_accounts)) != len(account_ids):
            raise HTTPException(status_code=400, detail="One or more accounts do not belong to this tenant")

        entry = JournalEntry(
            tenant_id=tenant_id,
            event_id=event_id,
            entry_number=f"JE-{utcnow().year}-{str(uuid.uuid4().int % 1000000).zfill(6)}",
            reference=reference,
            description=description,
            status="POSTED",
            created_by_id=created_by_id,
        )
        db.add(entry)
        await db.flush()
        for l in lines:
            db.add(
                JournalLine(
                    tenant_id=tenant_id,
                    journal_entry_id=entry.id,
                    account_id=uuid.UUID(str(l["account_id"])),
                    debit=Decimal(str(l.get("debit", 0))),
                    credit=Decimal(str(l.get("credit", 0))),
                    memo=l.get("memo"),
                )
            )
        await db.commit()
        await db.refresh(entry)
        return entry

    @staticmethod
    async def verify_milestone_payment(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        milestone_id: uuid.UUID,
        payment_method: str,
        is_security_deposit: bool = False,
    ) -> dict:
        milestone = (
            await db.execute(
                select(PaymentMilestone).where(
                    PaymentMilestone.id == milestone_id,
                    PaymentMilestone.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if not milestone:
            raise HTTPException(status_code=404, detail="Payment milestone not found")

        invoice = (
            await db.execute(
                select(Invoice).where(Invoice.id == milestone.invoice_id, Invoice.tenant_id == tenant_id)
            )
        ).scalar_one()

        cfg = (
            await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not cfg:
            raise HTTPException(status_code=400, detail="AccountingConfig missing for tenant")

        amount = Decimal(str(milestone.amount_due))
        debit_acc = cfg.cash_account_id if payment_method.upper() == "CASH" else cfg.bank_account_id
        credit_acc = cfg.security_deposit_liab_id if is_security_deposit else cfg.accounts_receivable_id

        entry = await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=user_id,
            reference=f"PAY-{invoice.invoice_number}",
            description=f"Verified payment ({payment_method}) for {milestone.title}",
            event_id=invoice.event_id,
            lines=[
                {"account_id": debit_acc, "debit": amount, "credit": Decimal("0.00"), "memo": milestone.title},
                {"account_id": credit_acc, "debit": Decimal("0.00"), "credit": amount, "memo": milestone.title},
            ],
        )

        milestone.paid_amount = amount
        milestone.payment_method = payment_method
        milestone.status = "PAID"
        milestone.paid_at = utcnow()

        if is_security_deposit:
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
            total_paid = sum((Decimal(str(m.paid_amount)) for m in all_milestones), Decimal("0.00"))
            if total_paid >= Decimal(str(invoice.total_amount)):
                invoice.status = InvoiceStatus.PAID
            elif total_paid > Decimal("0.00"):
                invoice.status = InvoiceStatus.PARTIALLY_PAID

        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=invoice.event_id,
                actor_id=user_id,
                action="PAYMENT_VERIFIED",
                new_value={
                    "milestone_id": str(milestone.id),
                    "amount": float(amount),
                    "is_security_deposit": is_security_deposit,
                    "journal_entry_id": str(entry.id),
                },
            )
        )
        await db.commit()
        return {"status": "PAID", "journal_entry_id": str(entry.id)}

    @staticmethod
    async def record_verified_payment(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        event_id: uuid.UUID,
        amount: Decimal,
        is_security_deposit: bool = False,
        payment_method: str = "KURAIMI_BANK",
        reference: str = "Verified Transfer",
    ) -> JournalEntry:
        cfg = (
            await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not cfg:
            raise HTTPException(status_code=400, detail="AccountingConfig missing for tenant")

        debit_acc = cfg.cash_account_id if payment_method.upper() == "CASH" else cfg.bank_account_id
        credit_acc = cfg.security_deposit_liab_id if is_security_deposit else cfg.accounts_receivable_id
        if not debit_acc or not credit_acc:
            raise HTTPException(status_code=400, detail="AccountingConfig accounts incomplete for tenant")

        entry = await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=user_id,
            reference=reference,
            description=f"Verified payment ({payment_method}) — {reference}",
            event_id=event_id,
            lines=[
                {"account_id": debit_acc, "debit": amount, "credit": Decimal("0.00"), "memo": reference},
                {"account_id": credit_acc, "debit": Decimal("0.00"), "credit": amount, "memo": reference},
            ],
        )

        db.add(
            AuditLog(
                tenant_id=tenant_id,
                event_id=event_id,
                actor_id=user_id,
                action="PAYMENT_VERIFIED",
                new_value={
                    "amount": float(amount),
                    "is_security_deposit": is_security_deposit,
                    "payment_method": payment_method,
                    "journal_entry_id": str(entry.id),
                },
            )
        )
        await db.commit()
        await db.refresh(entry)
        return entry

    @staticmethod
    async def get_trial_balance(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
        accounts = (
            await db.execute(
                select(ChartOfAccount)
                .where(ChartOfAccount.tenant_id == tenant_id)
                .order_by(ChartOfAccount.code.asc())
            )
        ).scalars().all()

        agg_rows = (
            await db.execute(
                select(
                    JournalLine.account_id,
                    func.coalesce(func.sum(JournalLine.debit), 0),
                    func.coalesce(func.sum(JournalLine.credit), 0),
                )
                .where(JournalLine.tenant_id == tenant_id)
                .group_by(JournalLine.account_id)
            )
        ).all()
        totals_by_acc = {row[0]: (Decimal(str(row[1])), Decimal(str(row[2]))) for row in agg_rows}

        rows = []
        grand_debit = Decimal("0.00")
        grand_credit = Decimal("0.00")
        for acc in accounts:
            d, c = totals_by_acc.get(acc.id, (Decimal("0.00"), Decimal("0.00")))
            grand_debit += d
            grand_credit += c
            rows.append(
                {
                    "account_id": str(acc.id),
                    "code": acc.code,
                    "name_ar": acc.name_ar,
                    "name_en": acc.name_en,
                    "account_type": acc.account_type.value,
                    "total_debit": float(d),
                    "total_credit": float(c),
                    "balance": float(d - c),
                }
            )
        return {
            "rows": rows,
            "total_debit": float(grand_debit),
            "total_credit": float(grand_credit),
            "is_balanced": abs(grand_debit - grand_credit) < Decimal("0.01"),
        }

    @staticmethod
    async def get_event_pnl(db: AsyncSession, tenant_id: uuid.UUID, event_id: uuid.UUID) -> dict:
        event = (
            await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        invoices = (
            await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == tenant_id))
        ).scalars().all()
        gross = sum((Decimal(str(i.subtotal)) for i in invoices), Decimal("0.00"))
        discounts = sum((Decimal(str(i.discount_amount)) for i in invoices), Decimal("0.00"))
        net_rev = gross - discounts
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
                select(EventExpense).where(EventExpense.event_id == event_id, EventExpense.tenant_id == tenant_id)
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
                {"category": e.category, "description": e.description, "amount": float(e.amount)} for e in expenses
            ],
            "total_expenses": float(total_exp),
            "net_profit": float(profit),
            "margin_percent": float((profit / net_rev * 100).quantize(Decimal("0.01"))) if net_rev > 0 else 0.0,
            "security_deposit_held": float(deposit_held),
        }
