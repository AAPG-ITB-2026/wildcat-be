CREATE OR REPLACE FUNCTION check_member_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM members WHERE team_id = NEW.team_id) >= 2 THEN
        RAISE EXCEPTION 'limit_reached_max_2_members'
        USING DETAIL = 'Maximum team members reached (2 members)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- bind function to action
CREATE TRIGGER enforce_member_limit
BEFORE INSERT ON members
FOR EACH ROW
EXECUTE FUNCTION check_member_limit();
