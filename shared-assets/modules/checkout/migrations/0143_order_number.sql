-- Sequential order numbers starting from 7500 for human-friendly tracking
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 7500;

-- Add column; existing rows get auto-filled with sequential values from the sequence
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_number integer NOT NULL DEFAULT nextval('order_number_seq') UNIQUE;

-- Tie the sequence lifecycle to the column
ALTER SEQUENCE order_number_seq OWNED BY orders.order_number;
