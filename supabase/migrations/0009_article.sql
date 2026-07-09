-- 0009_article.sql — longer "article" paragraph shown in the rumor detail view

alter table rumors add column article text;
