BEGIN;
CREATE SCHEMA subshare;
CREATE SCHEMA subshare_private;
REVOKE ALL ON SCHEMA subshare, subshare_private FROM PUBLIC;

CREATE TYPE subshare.order_status AS ENUM ('pending','escrow','completed','disputed','refunded');
CREATE TYPE subshare.payment_status AS ENUM ('pending','paid','failed','refund_pending','refunded');
CREATE TABLE subshare.users (
 id bigint PRIMARY KEY CHECK (id > 0), username varchar(64), first_name varchar(256) NOT NULL,
 balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
 rating numeric(3,2) NOT NULL DEFAULT 5 CHECK (rating BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Money is in integer kopecks. Catalog contains no access credentials.
CREATE TABLE subshare.subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), host_id bigint NOT NULL REFERENCES subshare.users(id),
 service varchar(128) NOT NULL, slug varchar(64) NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 category text NOT NULL CHECK (category IN ('design','education','media','vpn')),
 slots integer NOT NULL CHECK (slots BETWEEN 1 AND 10),
 available_slots integer NOT NULL CHECK (available_slots BETWEEN 0 AND slots),
 price bigint NOT NULL CHECK (price BETWEEN 1 AND 100000000), currency text NOT NULL DEFAULT 'RUB' CHECK (currency='RUB'),
 invite_type text NOT NULL CHECK (invite_type IN ('link','email')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','full','archived')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id, host_id),
 CHECK (status='archived' OR (status='active' AND available_slots>0) OR (status='full' AND available_slots=0))
);
CREATE TABLE subshare_private.subscription_access (
 subscription_id uuid PRIMARY KEY REFERENCES subshare.subscriptions(id),
 invite_url text CHECK (invite_url ~ '^https://'), instructions text CHECK (length(instructions)<=10000)
);
CREATE TABLE subshare.orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL,
 host_id bigint NOT NULL, buyer_id bigint NOT NULL REFERENCES subshare.users(id),
 FOREIGN KEY (subscription_id,host_id) REFERENCES subshare.subscriptions(id,host_id),
 total_amount bigint NOT NULL CHECK (total_amount BETWEEN 1 AND 100000000),
 platform_fee bigint GENERATED ALWAYS AS ((total_amount*15+50)/100) STORED,
 host_earnings bigint GENERATED ALWAYS AS (total_amount-(total_amount*15+50)/100) STORED,
 status subshare.order_status NOT NULL DEFAULT 'pending',
 payment_status subshare.payment_status NOT NULL DEFAULT 'pending',
 provider text NOT NULL CHECK (provider IN ('yookassa','lava','robokassa')),
 payment_invoice_id text, idempotency_key uuid NOT NULL,
 payment_expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 paid_at timestamptz, escrow_started_at timestamptz, auto_confirm_deadline timestamptz,
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (buyer_id,idempotency_key), UNIQUE (provider,payment_invoice_id), CHECK (buyer_id<>host_id),
 CHECK (status<>'escrow' OR (payment_status='paid' AND auto_confirm_deadline IS NOT NULL)),
 CHECK (status<>'disputed' OR auto_confirm_deadline IS NULL),
 CHECK (status<>'completed' OR (payment_status='paid' AND completed_at IS NOT NULL)),
 CHECK (status<>'refunded' OR payment_status='refunded')
);
CREATE TABLE subshare_private.order_access (
 order_id uuid PRIMARY KEY REFERENCES subshare.orders(id), invite_url text CHECK (invite_url ~ '^https://'),
 participant_email text CHECK (length(participant_email)<=254), instructions text,
 email_invited_at timestamptz
);
CREATE TABLE subshare.disputes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES subshare.orders(id),
 initiator_id bigint NOT NULL REFERENCES subshare.users(id), reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 4000),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved_buyer','resolved_host')),
 admin_notes text, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE subshare_private.payment_events (
 provider text NOT NULL, event_id text NOT NULL, order_id uuid NOT NULL REFERENCES subshare.orders(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,event_id)
);
CREATE TABLE subshare_private.ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES subshare.orders(id),
 user_id bigint NOT NULL REFERENCES subshare.users(id), amount bigint NOT NULL CHECK (amount>=0),
 kind text NOT NULL CHECK (kind IN ('host_credit','platform_fee')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,kind)
);
-- Workers deliver notifications and provider refunds with stable idempotency keys.
CREATE TABLE subshare_private.outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES subshare.orders(id),
 kind text NOT NULL CHECK (kind IN ('escrow','completed','disputed','refund_requested','refunded')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0), available_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz, UNIQUE(order_id,kind)
);
CREATE INDEX catalog_filter ON subshare.subscriptions(category,created_at DESC) WHERE status='active';
CREATE INDEX buyer_orders ON subshare.orders(buyer_id,created_at DESC);
CREATE INDEX host_orders ON subshare.orders(host_id,created_at DESC);
CREATE INDEX escrow_deadlines ON subshare.orders(auto_confirm_deadline) WHERE status='escrow';
CREATE INDEX pending_deadlines ON subshare.orders(payment_expires_at) WHERE status='pending';
CREATE INDEX outbox_ready ON subshare_private.outbox(available_at) WHERE delivered_at IS NULL;

-- Call ONLY after server-side provider verification, with amount/currency fetched from the provider.
-- Lock order, then subscription. A paid loser of the last-slot race gets a durable refund request.
CREATE FUNCTION subshare_private.activate_payment(p_order uuid,p_provider text,p_invoice text,p_event text,p_amount bigint,p_currency text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o subshare.orders; s subshare.subscriptions; rows_changed integer;
BEGIN
 SELECT * INTO STRICT o FROM subshare.orders WHERE id=p_order FOR UPDATE;
 IF o.provider<>p_provider OR o.payment_invoice_id IS DISTINCT FROM p_invoice OR p_invoice IS NULL
    OR o.total_amount<>p_amount OR p_currency<>'RUB' OR p_event IS NULL OR length(p_event)=0 THEN
  RAISE EXCEPTION 'Payment mismatch';
 END IF;
 INSERT INTO subshare_private.payment_events(provider,event_id,order_id) VALUES(p_provider,p_event,p_order)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS rows_changed=ROW_COUNT;
 IF rows_changed=0 THEN
  IF NOT EXISTS(SELECT 1 FROM subshare_private.payment_events WHERE provider=p_provider AND event_id=p_event AND order_id=p_order) THEN
   RAISE EXCEPTION 'Event belongs to another order';
  END IF;
  RETURN o.status::text;
 END IF;
 IF o.payment_status IN ('paid','refund_pending','refunded') THEN RETURN o.status::text; END IF;
 SELECT * INTO STRICT s FROM subshare.subscriptions WHERE id=o.subscription_id FOR UPDATE;
 IF o.status<>'pending' OR o.payment_expires_at<=clock_timestamp() OR s.status<>'active' OR s.available_slots=0 THEN
  UPDATE subshare.orders SET payment_status='refund_pending',paid_at=now(),updated_at=now() WHERE id=p_order;
  INSERT INTO subshare_private.outbox(order_id,kind) VALUES(p_order,'refund_requested') ON CONFLICT DO NOTHING;
  RETURN 'refund_pending';
 END IF;
 UPDATE subshare.subscriptions SET available_slots=available_slots-1,
  status=CASE WHEN available_slots=1 THEN 'full' ELSE 'active' END WHERE id=s.id;
 UPDATE subshare.orders SET status='escrow',payment_status='paid',paid_at=now(),escrow_started_at=now(),
  auto_confirm_deadline=now()+interval '24 hours',updated_at=now() WHERE id=p_order;
 INSERT INTO subshare_private.order_access(order_id,invite_url,instructions)
 SELECT p_order,invite_url,instructions FROM subshare_private.subscription_access WHERE subscription_id=s.id
 ON CONFLICT(order_id) DO UPDATE SET invite_url=EXCLUDED.invite_url,instructions=EXCLUDED.instructions;
 INSERT INTO subshare_private.outbox(order_id,kind) VALUES(p_order,'escrow') ON CONFLICT DO NOTHING;
 RETURN 'escrow';
END $$;

CREATE FUNCTION subshare_private.confirm_order(p_order uuid,p_buyer bigint,p_timeout boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o subshare.orders;
BEGIN
 SELECT * INTO STRICT o FROM subshare.orders WHERE id=p_order FOR UPDATE;
 IF o.buyer_id<>p_buyer THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF o.status='completed' THEN RETURN 'completed'; END IF;
 IF o.status<>'escrow' OR (p_timeout AND o.auto_confirm_deadline>clock_timestamp()) THEN RAISE EXCEPTION 'Order cannot be confirmed'; END IF;
 INSERT INTO subshare_private.ledger(order_id,user_id,amount,kind) VALUES
  (p_order,o.host_id,o.host_earnings,'host_credit'),(p_order,o.host_id,o.platform_fee,'platform_fee');
 UPDATE subshare.users SET balance=balance+o.host_earnings WHERE id=o.host_id;
 UPDATE subshare.orders SET status='completed',completed_at=now(),auto_confirm_deadline=NULL,updated_at=now() WHERE id=p_order;
 INSERT INTO subshare_private.outbox(order_id,kind) VALUES(p_order,'completed');
 RETURN 'completed';
END $$;

CREATE FUNCTION subshare_private.open_dispute(p_order uuid,p_buyer bigint,p_reason text)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o subshare.orders; result uuid;
BEGIN
 SELECT * INTO STRICT o FROM subshare.orders WHERE id=p_order FOR UPDATE;
 IF o.buyer_id<>p_buyer THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF o.status='disputed' THEN SELECT id INTO STRICT result FROM subshare.disputes WHERE order_id=p_order; RETURN result; END IF;
 IF o.status<>'escrow' OR o.auto_confirm_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Dispute window closed'; END IF;
 INSERT INTO subshare.disputes(order_id,initiator_id,reason) VALUES(p_order,p_buyer,p_reason) RETURNING id INTO result;
 UPDATE subshare.orders SET status='disputed',auto_confirm_deadline=NULL,updated_at=now() WHERE id=p_order;
 INSERT INTO subshare_private.outbox(order_id,kind) VALUES(p_order,'disputed');
 RETURN result;
END $$;

-- The API must supply the actor from verified Telegram session, never from request JSON.
CREATE FUNCTION subshare_private.read_order_access(p_order uuid,p_actor bigint)
RETURNS TABLE(invite_url text,participant_email text,instructions text,email_invited_at timestamptz)
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o subshare.orders;
BEGIN
 SELECT * INTO STRICT o FROM subshare.orders WHERE id=p_order;
 IF p_actor<>o.buyer_id AND p_actor<>o.host_id THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF o.status NOT IN ('escrow','completed','disputed') THEN RETURN; END IF;
 RETURN QUERY SELECT a.invite_url,a.participant_email,a.instructions,a.email_invited_at
 FROM subshare_private.order_access a WHERE a.order_id=p_order;
END $$;

-- Project schemas are backend-only; Supabase browser roles receive no grants.
-- RLS is a second layer even if someone later grants table privileges accidentally.
ALTER TABLE subshare.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subshare.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subshare.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE subshare.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subshare_private.subscription_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE subshare_private.order_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE subshare_private.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subshare_private.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE subshare_private.outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA subshare,subshare_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA subshare_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA subshare_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
